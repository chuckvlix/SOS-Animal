"""Business logic for complaints draft/submit lifecycle, immutability, and PDF rendering."""

import uuid
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from fastapi import HTTPException, status
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.config import get_settings
from app.core.database import utc_now
from app.core.storage import (
    MIME_TO_EXTENSION,
    PresignedDownloadResult,
    S3ClientProtocol,
    S3DocumentClientProtocol,
    UploadValidationError,
    generate_presigned_download,
    upload_document_bytes,
    validate_upload_metadata,
)
from app.modules.auth.models import User, UserRole
from app.modules.complaints.models import (
    Complaint,
    ComplaintEvidence,
    ComplaintStatus,
    EvidenceType,
    OffenseCategory,
    OffenseMainType,
)
from app.modules.complaints.schemas import (
    TRACKING_CODE_PATTERN,
    ComplaintCreateRequest,
    ComplaintEvidenceCreateRequest,
    ComplaintPublicTrackingRead,
    ComplaintUpdateRequest,
)

_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "templates"
_JINJA_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)

_MALTRATO_LEGAL_BASIS = (
    "Constitución Política del Estado (Arts. 33 y 405); Ley N.° 700/2015 para la Defensa de los "
    "Animales contra Actos de Crueldad y Maltrato; Código Penal Boliviano Art. 350 bis "
    "(Tratos Crueles); D.S. N.° 4341/2020; Ley Municipal Autonómica N.° 252/2022 de Sucre."
)
_BIOCIDIO_LEGAL_BASIS = (
    "Constitución Política del Estado (Arts. 33 y 405); Ley N.° 700/2015 para la Defensa de los "
    "Animales contra Actos de Crueldad y Maltrato; Código Penal Boliviano Art. 350 ter "
    "(Biocidio); D.S. N.° 4341/2020; Ley Municipal Autonómica N.° 252/2022 de Sucre."
)

DEFAULT_OFFENSE_CATEGORIES: tuple[tuple[OffenseMainType, str, str], ...] = (
    (OffenseMainType.MALTRATO, "Maltrato físico", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.MALTRATO, "Maltrato psicológico", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.MALTRATO, "Maltrato por negligencia", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.MALTRATO, "Abandono", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.MALTRATO, "Explotación", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.MALTRATO, "Maltrato por confinamiento", _MALTRATO_LEGAL_BASIS),
    (
        OffenseMainType.MALTRATO,
        "Maltrato sanitario (falta de atención médica)",
        _MALTRATO_LEGAL_BASIS,
    ),
    (OffenseMainType.MALTRATO, "Maltrato sexual", _MALTRATO_LEGAL_BASIS),
    (OffenseMainType.BIOCIDIO, "Biocidio por ensañamiento", _BIOCIDIO_LEGAL_BASIS),
    (OffenseMainType.BIOCIDIO, "Biocidio por motivos fútiles", _BIOCIDIO_LEGAL_BASIS),
    (OffenseMainType.BIOCIDIO, "Biocidio múltiple (varios animales)", _BIOCIDIO_LEGAL_BASIS),
    (OffenseMainType.BIOCIDIO, "Biocidio como consecuencia de maltrato", _BIOCIDIO_LEGAL_BASIS),
    (OffenseMainType.BIOCIDIO, "Biocidio por crueldad", _BIOCIDIO_LEGAL_BASIS),
)

_EVIDENCE_ALLOWED_MIMES: dict[EvidenceType, frozenset[str]] = {
    EvidenceType.FOTO: frozenset({"image/jpeg", "image/png", "image/webp"}),
    EvidenceType.VIDEO: frozenset({"video/mp4"}),
    EvidenceType.DOCUMENTO: frozenset({"application/pdf"}),
}

_ALLOWED_INSTITUTIONAL_TRANSITIONS: dict[ComplaintStatus, frozenset[ComplaintStatus]] = {
    ComplaintStatus.ENVIADA: frozenset(
        {ComplaintStatus.EN_ATENCION_CEMZOO, ComplaintStatus.CERRADA}
    ),
    ComplaintStatus.EN_ATENCION_CEMZOO: frozenset({ComplaintStatus.CERRADA}),
}

_INSTITUTIONAL_ROLES: frozenset[UserRole] = frozenset({UserRole.ADMIN, UserRole.GESTOR_CEMZOO})


def ensure_offense_categories_seeded(session: Session) -> None:
    """Idempotently seed the 13 statutory Maltrato and Biocidio offense modalities."""
    existing_names = set(session.exec(select(OffenseCategory.subtype_name)).all())
    missing = [
        OffenseCategory(main_type=main_type, subtype_name=subtype_name, legal_basis=legal_basis)
        for main_type, subtype_name, legal_basis in DEFAULT_OFFENSE_CATEGORIES
        if subtype_name not in existing_names
    ]
    if not missing:
        return
    session.add_all(missing)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()


def list_offense_categories(
    *,
    session: Session,
    main_type: OffenseMainType | None = None,
) -> list[OffenseCategory]:
    """Return seeded legal offense categories optionally filtered by main_type."""
    ensure_offense_categories_seeded(session)
    stmt = select(OffenseCategory)
    if main_type is not None:
        stmt = stmt.where(OffenseCategory.main_type == main_type)
    stmt = stmt.order_by(sa.asc(OffenseCategory.id))  # type: ignore[arg-type]
    return list(session.exec(stmt).all())


def _get_complaint_or_404(session: Session, complaint_id: uuid.UUID) -> Complaint:
    stmt = (
        select(Complaint)
        .where(Complaint.id == complaint_id)
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
    )
    complaint = session.exec(stmt).first()
    if complaint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint not found.",
        )
    return complaint


def _ensure_complaint_owner(complaint: Complaint, current_user: User) -> None:
    if complaint.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this complaint.",
        )


def _ensure_complaint_read_access(complaint: Complaint, current_user: User) -> None:
    is_owner = complaint.user_id == current_user.id
    if is_owner:
        return
    if current_user.role in _INSTITUTIONAL_ROLES and complaint.is_immutable:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this complaint.",
    )


def _ensure_mutable_draft(complaint: Complaint) -> None:
    if complaint.is_immutable or complaint.status != ComplaintStatus.BORRADOR:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted complaints are immutable and cannot be modified or deleted.",
        )


def _get_category_or_404(session: Session, category_id: int) -> OffenseCategory:
    ensure_offense_categories_seeded(session)
    category = session.get(OffenseCategory, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Offense category not found.",
        )
    return category


def create_draft_complaint(
    *,
    session: Session,
    current_user: User,
    payload: ComplaintCreateRequest,
) -> Complaint:
    """Create a mutable BORRADOR complaint for the authenticated citizen."""
    _get_category_or_404(session, payload.offense_category_id)
    complaint = Complaint(
        user_id=current_user.id,
        offense_category_id=payload.offense_category_id,
        incident_date=payload.incident_date,
        incident_address=payload.incident_address,
        latitude=payload.latitude,
        longitude=payload.longitude,
        description=payload.description,
        status=ComplaintStatus.BORRADOR,
        is_immutable=False,
    )
    session.add(complaint)
    session.commit()
    return _get_complaint_or_404(session, complaint.id)


def list_user_complaints(*, session: Session, current_user: User) -> list[Complaint]:
    """List all complaints created by the authenticated citizen, newest first."""
    stmt = (
        select(Complaint)
        .where(Complaint.user_id == current_user.id)
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
        .order_by(sa.desc(Complaint.created_at))  # type: ignore[arg-type]
    )
    return list(session.exec(stmt).all())


def get_complaint_detail(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
) -> Complaint:
    """Return complaint details for its owner or institutional managers (if submitted)."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_read_access(complaint, current_user)
    return complaint


def update_draft_complaint(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    payload: ComplaintUpdateRequest,
) -> Complaint:
    """Update a mutable BORRADOR complaint; reject immutable complaints with HTTP 409."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    if (
        "offense_category_id" in payload.model_fields_set
        and payload.offense_category_id is not None
    ):
        _get_category_or_404(session, payload.offense_category_id)

    for field_name in payload.model_fields_set:
        setattr(complaint, field_name, getattr(payload, field_name))

    session.add(complaint)
    session.commit()
    return _get_complaint_or_404(session, complaint.id)


def delete_draft_complaint(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
) -> None:
    """Delete a mutable BORRADOR complaint; reject immutable complaints with HTTP 409."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)
    session.delete(complaint)
    session.commit()


def add_complaint_evidence(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    payload: ComplaintEvidenceCreateRequest,
) -> ComplaintEvidence:
    """Attach an uploaded MinIO evidence object to a mutable BORRADOR complaint."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    try:
        validate_upload_metadata(
            mime_type=payload.mime_type,
            file_size_bytes=payload.file_size_bytes,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    allowed_for_type = _EVIDENCE_ALLOWED_MIMES[payload.evidence_type]
    if payload.mime_type not in allowed_for_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"MIME type '{payload.mime_type}' does not match evidence type "
                f"'{payload.evidence_type.value}'."
            ),
        )

    expected_ext = MIME_TO_EXTENSION[payload.mime_type]
    if not payload.object_key.endswith(expected_ext):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"object_key extension must match '{expected_ext}' for '{payload.mime_type}'.",
        )

    duplicate = session.exec(
        select(ComplaintEvidence).where(ComplaintEvidence.object_key == payload.object_key)
    ).first()
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Evidence object key is already attached to a complaint.",
        )

    evidence = ComplaintEvidence(
        complaint_id=complaint.id,
        evidence_type=payload.evidence_type,
        object_key=payload.object_key,
        mime_type=payload.mime_type,
        file_size_bytes=payload.file_size_bytes,
    )
    session.add(evidence)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Evidence object key is already attached to a complaint.",
        ) from exc

    session.refresh(evidence)
    return evidence


def delete_complaint_evidence(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    evidence_id: uuid.UUID,
) -> None:
    """Remove an evidence item from a mutable BORRADOR complaint."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    evidence = session.get(ComplaintEvidence, evidence_id)
    if evidence is None or evidence.complaint_id != complaint.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint evidence not found.",
        )

    session.delete(evidence)
    session.commit()


def _format_utc(value: datetime | None, fallback: str) -> str:
    if value is None:
        return fallback
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return normalized.strftime("%Y-%m-%d %H:%M UTC")


def _restricted_url_fetcher(
    url: str,
    timeout: int = 10,
    ssl_context: object | None = None,
) -> dict[str, object]:
    """Block all external or local file fetches inside WeasyPrint to prevent SSRF."""
    raise ValueError(f"External resource fetching is disabled: {url}")


def _escape_pdf_text(text: str) -> str:
    ascii_safe = text.encode("latin-1", "replace").decode("latin-1")
    return ascii_safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_minimal_pdf_bytes(
    *,
    tracking_code: str,
    owner: User,
    complaint: Complaint,
    category: OffenseCategory,
) -> bytes:
    """Generate a valid minimal single-page PDF fallback when native Pango libs are absent."""
    lines = [
        "SOS ANIMAL - SUCRE, BOLIVIA",
        "DOCUMENTO DE DENUNCIA",
        f"Codigo de seguimiento: {tracking_code}",
        f"Fecha de emision: {_format_utc(complaint.submitted_at, '')}",
        f"Denunciante: {owner.full_name} (CI: {owner.ci_number or 'N/A'})",
        f"Telefono: {owner.phone or 'N/A'} | Domicilio: {owner.address or 'N/A'}",
        f"Tipificacion: {category.main_type.value} - {category.subtype_name}",
        f"Lugar del hecho: {complaint.incident_address}",
        f"Fecha del hecho: {_format_utc(complaint.incident_date, '')}",
        f"Evidencias adjuntas: {len(complaint.evidences)}",
    ]
    ops = ["BT", "/F1 11 Tf", "50 750 Td", "16 TL"]
    for idx, line in enumerate(lines):
        prefix = "" if idx == 0 else "T* "
        ops.append(f"{prefix}({_escape_pdf_text(line)}) Tj")
    ops.append("ET")
    stream_bytes = "\n".join(ops).encode("latin-1")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        ),
    ]

    output = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = [0]
    for obj in objects:
        offsets.append(len(output))
        output.extend(obj)

    xref_offset = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        (
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(output)


def render_complaint_html(*, session: Session, complaint: Complaint, owner: User) -> str:
    """Render the formal Documento de Denuncia HTML using Jinja2 autoescaping."""
    category = complaint.offense_category or _get_category_or_404(
        session, complaint.offense_category_id
    )
    template = _JINJA_ENV.get_template("complaint_pdf.html")
    return template.render(
        tracking_code=complaint.tracking_code or "BORRADOR (SIN CÓDIGO ASIGNADO)",
        submitted_at=_format_utc(complaint.submitted_at, "Pendiente de envío definitivo"),
        full_name=owner.full_name,
        ci_number=owner.ci_number or "No registrado",
        phone=owner.phone or "No registrado",
        address=owner.address or "No registrado",
        main_type=category.main_type.value,
        subtype_name=category.subtype_name,
        legal_basis=category.legal_basis,
        incident_date=_format_utc(complaint.incident_date, ""),
        incident_address=complaint.incident_address,
        latitude=complaint.latitude,
        longitude=complaint.longitude,
        description=complaint.description,
        evidences=[
            {
                "evidence_type": item.evidence_type.value,
                "object_key": item.object_key,
                "mime_type": item.mime_type,
            }
            for item in complaint.evidences
        ],
    )


def render_complaint_pdf_bytes(*, session: Session, complaint: Complaint, owner: User) -> bytes:
    """Render the Documento de Denuncia PDF with WeasyPrint (or dev fallback on missing libs)."""
    html = render_complaint_html(session=session, complaint=complaint, owner=owner)
    try:
        import weasyprint

        pdf_bytes = weasyprint.HTML(
            string=html,
            url_fetcher=_restricted_url_fetcher,
        ).write_pdf()
        return bytes(pdf_bytes)
    except OSError as exc:
        if get_settings().ENVIRONMENT in {"staging", "production"}:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="PDF rendering engine is unavailable in this environment.",
            ) from exc
        category = complaint.offense_category or _get_category_or_404(
            session, complaint.offense_category_id
        )
        return _build_minimal_pdf_bytes(
            tracking_code=complaint.tracking_code or "BORRADOR",
            owner=owner,
            complaint=complaint,
            category=category,
        )


def get_complaint_preview(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
) -> tuple[Complaint, str]:
    """Return Step 6 HTML preview of Documento de Denuncia."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_read_access(complaint, current_user)
    owner = session.get(User, complaint.user_id)
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint owner missing.",
        )
    html = render_complaint_html(session=session, complaint=complaint, owner=owner)
    return complaint, html


def _next_tracking_sequence(*, session: Session, year: int) -> int:
    suffix = f"-{year}"
    existing_codes = session.exec(
        select(Complaint.tracking_code).where(
            Complaint.tracking_code.is_not(None),  # type: ignore[union-attr]
            Complaint.tracking_code.like(f"SOS-%{suffix}"),  # type: ignore[union-attr]
        )
    ).all()
    max_seq = 0
    for code in existing_codes:
        if not code or not TRACKING_CODE_PATTERN.fullmatch(code):
            continue
        seq_part = int(code.split("-")[1])
        if seq_part > max_seq:
            max_seq = seq_part
    return max_seq + 1


def submit_complaint(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    s3_client: S3DocumentClientProtocol,
) -> Complaint:
    """Validate legal profile completeness, freeze complaint, and upload PDF to MinIO."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    missing_fields = [
        field_name
        for field_name, value in (
            ("full_name", current_user.full_name),
            ("ci_number", current_user.ci_number),
            ("phone", current_user.phone),
            ("address", current_user.address),
        )
        if not value or not value.strip()
    ]
    if missing_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Complete your user profile before submitting the complaint: "
                f"{', '.join(missing_fields)}."
            ),
        )

    submission_time = utc_now()
    year = submission_time.year
    base_seq = _next_tracking_sequence(session=session, year=year)

    for attempt in range(5):
        tracking_code = f"SOS-{base_seq + attempt:06d}-{year}"
        complaint.tracking_code = tracking_code
        complaint.submitted_at = submission_time
        complaint.status = ComplaintStatus.ENVIADA
        complaint.is_immutable = True

        pdf_bytes = render_complaint_pdf_bytes(
            session=session,
            complaint=complaint,
            owner=current_user,
        )
        object_key = f"complaints/{complaint.id}/{tracking_code}.pdf"
        try:
            stored_key = upload_document_bytes(
                data=pdf_bytes,
                object_key=object_key,
                mime_type="application/pdf",
                client=s3_client,
            )
        except UploadValidationError as exc:
            session.rollback()
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        complaint.pdf_url = stored_key
        session.add(complaint)
        try:
            session.commit()
            return _get_complaint_or_404(session, complaint.id)
        except IntegrityError:
            session.rollback()
            complaint = _get_complaint_or_404(session, complaint_id)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Could not allocate a unique tracking code; please retry.",
    )


def get_complaint_pdf_download_url(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    s3_client: S3ClientProtocol,
) -> PresignedDownloadResult:
    """Return a 180-second presigned GET URL for a submitted complaint's PDF."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_read_access(complaint, current_user)
    if not complaint.is_immutable or not complaint.pdf_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PDF document is only available after the complaint has been submitted.",
        )
    try:
        return generate_presigned_download(object_key=complaint.pdf_url, client=s3_client)
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def get_public_tracking(*, session: Session, tracking_code: str) -> ComplaintPublicTrackingRead:
    """Look up non-PII status metadata for a submitted complaint by tracking code."""
    normalized_code = tracking_code.strip().upper()
    if not TRACKING_CODE_PATTERN.fullmatch(normalized_code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="tracking_code must match format 'SOS-XXXXXX-YYYY'.",
        )

    stmt = (
        select(Complaint)
        .where(Complaint.tracking_code == normalized_code)
        .options(selectinload(Complaint.offense_category))  # type: ignore[arg-type]
    )
    complaint = session.exec(stmt).first()
    if (
        complaint is None
        or not complaint.is_immutable
        or complaint.submitted_at is None
        or complaint.offense_category is None
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint not found for the provided tracking code.",
        )

    return ComplaintPublicTrackingRead(
        tracking_code=normalized_code,
        status=complaint.status,
        main_type=complaint.offense_category.main_type,
        subtype_name=complaint.offense_category.subtype_name,
        legal_basis=complaint.offense_category.legal_basis,
        incident_date=complaint.incident_date,
        incident_address=complaint.incident_address,
        created_at=complaint.created_at,
        submitted_at=complaint.submitted_at,
    )


def list_institutional_complaints(
    *,
    session: Session,
    status_filter: ComplaintStatus | None = None,
    main_type: OffenseMainType | None = None,
) -> list[Complaint]:
    """List submitted complaints for CEMZOO/Admin management, excluding mutable drafts."""
    stmt = (
        select(Complaint)
        .where(Complaint.is_immutable == sa.true())
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
    )
    if status_filter is not None:
        if status_filter == ComplaintStatus.BORRADOR:
            return []
        stmt = stmt.where(Complaint.status == status_filter)
    if main_type is not None:
        stmt = stmt.join(OffenseCategory).where(OffenseCategory.main_type == main_type)
    stmt = stmt.order_by(sa.desc(Complaint.submitted_at))  # type: ignore[arg-type]
    return list(session.exec(stmt).all())


def update_complaint_status(
    *,
    session: Session,
    complaint_id: uuid.UUID,
    new_status: ComplaintStatus,
) -> Complaint:
    """Transition an immutable submitted complaint through CEMZOO institutional states."""
    complaint = _get_complaint_or_404(session, complaint_id)
    if not complaint.is_immutable or complaint.status == ComplaintStatus.BORRADOR:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Draft complaints must be submitted before institutional status updates.",
        )

    allowed_next = _ALLOWED_INSTITUTIONAL_TRANSITIONS.get(complaint.status, frozenset())
    if new_status not in allowed_next:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot transition complaint status from {complaint.status.value} "
                f"to {new_status.value}."
            ),
        )

    complaint.status = new_status
    session.add(complaint)
    session.commit()
    return _get_complaint_or_404(session, complaint.id)
