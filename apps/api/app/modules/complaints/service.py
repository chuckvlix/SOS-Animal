"""Business logic for complaints draft/submit lifecycle, immutability, and PDF rendering."""

import base64
import logging
import textwrap
import uuid
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from fastapi import HTTPException, status
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
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
    delete_storage_object,
    fetch_evidence_bytes,
    generate_presigned_download,
    upload_document_bytes,
    validate_upload_metadata,
    verify_evidence_object,
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
    ComplaintCategoryStat,
    ComplaintCreateRequest,
    ComplaintEvidenceCreateRequest,
    ComplaintStatsRead,
    ComplaintUpdateRequest,
)

logger = logging.getLogger(__name__)

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

MIN_PHOTOS_PER_COMPLAINT = 1
MAX_PHOTOS_PER_COMPLAINT = 3

_EVIDENCE_ALLOWED_MIMES: dict[EvidenceType, frozenset[str]] = {
    EvidenceType.FOTO: frozenset({"image/jpeg", "image/png", "image/webp"}),
}

_INSTITUTIONAL_ROLES: frozenset[UserRole] = frozenset({UserRole.ADMIN})

_ALLOWED_DATA_IMAGE_PREFIXES: tuple[str, ...] = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)


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


def _get_complaint_or_404(
    session: Session,
    complaint_id: uuid.UUID,
    *,
    lock_for_update: bool = False,
) -> Complaint:
    stmt = (
        select(Complaint)
        .where(Complaint.id == complaint_id)
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
    )
    if lock_for_update:
        stmt = stmt.with_for_update()
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


def list_user_complaints(
    *,
    session: Session,
    current_user: User,
    limit: int = 50,
    offset: int = 0,
) -> list[Complaint]:
    """List complaints created by the authenticated citizen, newest first."""
    stmt = (
        select(Complaint)
        .where(Complaint.user_id == current_user.id)
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
        .order_by(sa.desc(Complaint.created_at))  # type: ignore[arg-type]
        .offset(offset)
        .limit(limit)
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
    complaint = _get_complaint_or_404(session, complaint_id, lock_for_update=True)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    if (
        "offense_category_id" in payload.model_fields_set
        and payload.offense_category_id is not None
    ):
        _get_category_or_404(session, payload.offense_category_id)

    updates = {
        field_name: getattr(payload, field_name)
        for field_name in payload.model_fields_set
    }
    update_result = session.execute(
        sa.update(Complaint)
        .where(
            Complaint.id == complaint.id,
            Complaint.is_immutable == sa.false(),
            Complaint.status == ComplaintStatus.BORRADOR,
        )
        .values(**updates)
        .execution_options(synchronize_session=False)
    )
    if update_result.rowcount != 1:
        session.rollback()
        latest = _get_complaint_or_404(session, complaint_id)
        _ensure_mutable_draft(latest)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complaint state changed concurrently; cannot update draft.",
        )
    session.commit()
    session.expire_all()
    return _get_complaint_or_404(session, complaint.id)


def _cleanup_evidence_objects(
    *,
    evidence_keys: list[str],
    s3_client: S3DocumentClientProtocol,
) -> None:
    """Best-effort cleanup of MinIO evidence binaries after committed DB deletion."""
    if not evidence_keys:
        return
    bucket = get_settings().MINIO_BUCKET_EVIDENCES.strip()
    for object_key in evidence_keys:
        try:
            delete_storage_object(object_key=object_key, bucket=bucket, client=s3_client)
        except UploadValidationError as exc:
            logger.warning("Orphan evidence cleanup failed for %s: %s", object_key, exc)


def delete_draft_complaint(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    s3_client: S3DocumentClientProtocol,
) -> None:
    """Delete a mutable BORRADOR complaint and clean up attached MinIO evidence objects."""
    complaint = _get_complaint_or_404(session, complaint_id, lock_for_update=True)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)
    evidence_keys = [item.object_key for item in complaint.evidences]

    session.execute(
        sa.delete(ComplaintEvidence).where(ComplaintEvidence.complaint_id == complaint.id)
    )
    delete_result = session.execute(
        sa.delete(Complaint).where(
            Complaint.id == complaint.id,
            Complaint.is_immutable == sa.false(),
            Complaint.status == ComplaintStatus.BORRADOR,
        )
    )
    if delete_result.rowcount != 1:
        session.rollback()
        latest = _get_complaint_or_404(session, complaint_id)
        _ensure_mutable_draft(latest)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complaint state changed concurrently; cannot delete draft.",
        )
    session.commit()
    _cleanup_evidence_objects(evidence_keys=evidence_keys, s3_client=s3_client)


def add_complaint_evidence(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    payload: ComplaintEvidenceCreateRequest,
    s3_client: S3DocumentClientProtocol,
) -> ComplaintEvidence:
    """Attach a verified uploaded MinIO photograph (max 3) to a mutable BORRADOR complaint."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    if len(complaint.evidences) >= MAX_PHOTOS_PER_COMPLAINT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A maximum of {MAX_PHOTOS_PER_COMPLAINT} photographs can be attached "
                "to a complaint."
            ),
        )

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

    try:
        verify_evidence_object(
            object_key=payload.object_key,
            expected_mime_type=payload.mime_type,
            expected_size_bytes=payload.file_size_bytes,
            client=s3_client,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    locked_complaint = _get_complaint_or_404(session, complaint_id, lock_for_update=True)
    _ensure_complaint_owner(locked_complaint, current_user)
    _ensure_mutable_draft(locked_complaint)

    existing_ids = session.exec(
        select(ComplaintEvidence.id).where(ComplaintEvidence.complaint_id == locked_complaint.id)
    ).all()
    if len(existing_ids) >= MAX_PHOTOS_PER_COMPLAINT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A maximum of {MAX_PHOTOS_PER_COMPLAINT} photographs can be attached "
                "to a complaint."
            ),
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
        complaint_id=locked_complaint.id,
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
    s3_client: S3DocumentClientProtocol,
) -> None:
    """Remove an evidence item from a mutable BORRADOR complaint and delete its S3 object."""
    complaint = _get_complaint_or_404(session, complaint_id, lock_for_update=True)
    _ensure_complaint_owner(complaint, current_user)
    _ensure_mutable_draft(complaint)

    evidence = session.get(ComplaintEvidence, evidence_id)
    if evidence is None or evidence.complaint_id != complaint.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint evidence not found.",
        )

    object_key = evidence.object_key
    mutable_parent_subquery = select(Complaint.id).where(
        Complaint.id == complaint.id,
        Complaint.is_immutable == sa.false(),
        Complaint.status == ComplaintStatus.BORRADOR,
    )
    delete_result = session.execute(
        sa.delete(ComplaintEvidence).where(
            ComplaintEvidence.id == evidence.id,
            ComplaintEvidence.complaint_id == complaint.id,
            ComplaintEvidence.complaint_id.in_(mutable_parent_subquery),
        )
    )
    if delete_result.rowcount != 1:
        session.rollback()
        latest = _get_complaint_or_404(session, complaint_id)
        _ensure_mutable_draft(latest)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint evidence not found.",
        )

    session.commit()
    _cleanup_evidence_objects(evidence_keys=[object_key], s3_client=s3_client)


def _format_utc(value: datetime | None, fallback: str) -> str:
    if value is None:
        return fallback
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return normalized.strftime("%Y-%m-%d %H:%M UTC")


class _RestrictedURLFetcher:
    """Callable URL fetcher allowing only safe base64 image data URIs inside WeasyPrint."""

    _fail_on_errors: bool = False

    def __call__(
        self,
        url: str,
        timeout: int = 10,
        ssl_context: object | None = None,
    ) -> object:
        """Block external/local fetches while permitting embedded base64 photo data URIs."""
        if not url.startswith(_ALLOWED_DATA_IMAGE_PREFIXES):
            raise ValueError(f"External resource fetching is disabled: {url}")

        from weasyprint.urls import URLFetcher

        return URLFetcher(
            allowed_protocols={"data"},
            fail_on_errors=self._fail_on_errors,
        ).fetch(url)


_restricted_url_fetcher = _RestrictedURLFetcher()


def _escape_pdf_text(text: str) -> str:
    ascii_safe = text.encode("latin-1", "replace").decode("latin-1")
    return ascii_safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap_pdf_lines(raw_lines: list[str], width: int = 84) -> list[str]:
    wrapped: list[str] = []
    for raw in raw_lines:
        for segment in raw.split("\n"):
            if not segment.strip():
                wrapped.append("")
            else:
                wrapped.extend(textwrap.wrap(segment, width=width) or [""])
    return wrapped


def _build_minimal_pdf_bytes(
    *,
    tracking_code: str,
    owner: User,
    complaint: Complaint,
    category: OffenseCategory,
) -> bytes:
    """Generate a valid PDF fallback including legal basis, facts, and photo annex metadata."""
    raw_lines = [
        "SOS ANIMAL - SUCRE, BOLIVIA",
        "DOCUMENTO DE DENUNCIA",
        f"Codigo de referencia: {tracking_code}",
        f"Fecha de emision: {_format_utc(complaint.submitted_at, 'Pendiente de envio definitivo')}",
        f"Denunciante: {owner.full_name} (CI: {owner.ci_number or 'N/A'})",
        f"Telefono: {owner.phone or 'N/A'} | Domicilio: {owner.address or 'N/A'}",
        f"Tipificacion: {category.main_type.value} - {category.subtype_name}",
        f"Fundamento legal: {category.legal_basis}",
        f"Lugar del hecho: {complaint.incident_address}",
        f"Fecha del hecho: {_format_utc(complaint.incident_date, '')}",
    ]
    if complaint.latitude is not None and complaint.longitude is not None:
        raw_lines.append(f"Coordenadas GPS: {complaint.latitude}, {complaint.longitude}")
    raw_lines.append("Relato de los hechos:")
    raw_lines.append(complaint.description)
    raw_lines.append(f"Fotografias adjuntas ({len(complaint.evidences)}):")
    if complaint.evidences:
        raw_lines.append("ANEXO FOTOGRAFICO")
        for idx, item in enumerate(complaint.evidences, start=1):
            raw_lines.append(f"- Fotografia {idx}: {item.object_key} ({item.mime_type})")

    all_lines = _wrap_pdf_lines(raw_lines)
    lines_per_page = 42
    pages = [
        all_lines[idx : idx + lines_per_page]
        for idx in range(0, max(1, len(all_lines)), lines_per_page)
    ]

    page_obj_nums = [4 + idx * 2 for idx in range(len(pages))]
    kids_ref = " ".join(f"{num} 0 R" for num in page_obj_nums)
    objects: list[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        f"2 0 obj\n<< /Type /Pages /Kids [{kids_ref}] /Count {len(pages)} >>\nendobj\n".encode(
            "ascii"
        ),
        b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]

    for idx, page_lines in enumerate(pages):
        page_num = 4 + idx * 2
        content_num = 5 + idx * 2
        ops = ["BT", "/F1 10 Tf", "50 750 Td", "15 TL"]
        for line_idx, line in enumerate(page_lines):
            prefix = "" if line_idx == 0 else "T* "
            ops.append(f"{prefix}({_escape_pdf_text(line)}) Tj")
        ops.append("ET")
        stream_bytes = "\n".join(ops).encode("latin-1")
        objects.append(
            (
                f"{page_num} 0 obj\n"
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_num} 0 R >>\n"
                f"endobj\n"
            ).encode("ascii")
        )
        objects.append(
            f"{content_num} 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        )

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


def _build_photo_annex_items(
    *,
    complaint: Complaint,
    s3_client: S3DocumentClientProtocol | None,
) -> list[dict[str, str]]:
    """Fetch photo evidence bytes from MinIO and encode safe base64 data URIs."""
    if s3_client is None:
        return []

    photos = sorted(
        (
            item
            for item in complaint.evidences
            if item.evidence_type == EvidenceType.FOTO and item.mime_type in MIME_TO_EXTENSION
        ),
        key=lambda item: (item.created_at, str(item.id)),
    )
    annex_items: list[dict[str, str]] = []
    for item in photos:
        try:
            raw_bytes = fetch_evidence_bytes(object_key=item.object_key, client=s3_client)
        except UploadValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        encoded = base64.b64encode(raw_bytes).decode("ascii")
        annex_items.append(
            {
                "data_uri": f"data:{item.mime_type};base64,{encoded}",
                "mime_type": item.mime_type,
                "object_key": item.object_key,
            }
        )
    return annex_items


def render_complaint_html(
    *,
    session: Session,
    complaint: Complaint,
    owner: User,
    s3_client: S3DocumentClientProtocol | None = None,
) -> str:
    """Render the formal Documento de Denuncia HTML with embedded photographic annex."""
    category = complaint.offense_category or _get_category_or_404(
        session, complaint.offense_category_id
    )
    photo_annex = _build_photo_annex_items(complaint=complaint, s3_client=s3_client)
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
        photo_annex=photo_annex,
    )


def _is_missing_weasyprint_libs_error(exc: OSError) -> bool:
    message = str(exc).lower()
    return (
        "cannot load library" in message
        or "dlopen" in message
        or "libgobject" in message
        or "libpango" in message
    )


def render_complaint_pdf_bytes(
    *,
    session: Session,
    complaint: Complaint,
    owner: User,
    s3_client: S3DocumentClientProtocol | None = None,
) -> bytes:
    """Render the Documento de Denuncia PDF with WeasyPrint (or dev fallback on missing libs)."""
    html = render_complaint_html(
        session=session,
        complaint=complaint,
        owner=owner,
        s3_client=s3_client,
    )
    try:
        import weasyprint

        pdf_bytes = weasyprint.HTML(
            string=html,
            url_fetcher=_restricted_url_fetcher,
        ).write_pdf()
        return bytes(pdf_bytes)
    except OSError as exc:
        if (
            get_settings().ENVIRONMENT in {"staging", "production"}
            or not _is_missing_weasyprint_libs_error(exc)
        ):
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
    s3_client: S3DocumentClientProtocol | None = None,
) -> tuple[Complaint, str]:
    """Return Step 3 HTML preview of Documento de Denuncia with embedded photo annex."""
    complaint = _get_complaint_or_404(session, complaint_id)
    _ensure_complaint_read_access(complaint, current_user)
    owner = session.get(User, complaint.user_id)
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint owner missing.",
        )
    html = render_complaint_html(
        session=session,
        complaint=complaint,
        owner=owner,
        s3_client=s3_client,
    )
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


def _cleanup_document_object(*, object_key: str, s3_client: S3DocumentClientProtocol) -> None:
    """Best-effort cleanup if PDF upload succeeded before a failed DB commit."""
    bucket = get_settings().MINIO_BUCKET_DOCUMENTS.strip()
    try:
        delete_storage_object(object_key=object_key, bucket=bucket, client=s3_client)
    except UploadValidationError as exc:
        logger.warning("Failed to clean up uncommitted PDF %s: %s", object_key, exc)


def submit_complaint(
    *,
    session: Session,
    current_user: User,
    complaint_id: uuid.UUID,
    s3_client: S3DocumentClientProtocol,
) -> Complaint:
    """Validate profile and 1-3 photos, freeze complaint, and upload PDF to MinIO."""
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

    photo_count = len(complaint.evidences)
    if photo_count < MIN_PHOTOS_PER_COMPLAINT or photo_count > MAX_PHOTOS_PER_COMPLAINT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Attach between {MIN_PHOTOS_PER_COMPLAINT} and "
                f"{MAX_PHOTOS_PER_COMPLAINT} photographs before submitting the complaint."
            ),
        )

    submission_time = utc_now()
    year = submission_time.year
    min_next_seq = 1

    for _attempt in range(5):
        seq = max(min_next_seq, _next_tracking_sequence(session=session, year=year))
        min_next_seq = seq + 1
        tracking_code = f"SOS-{seq:06d}-{year}"
        object_key = f"complaints/{complaint.id}/{tracking_code}.pdf"

        claim_stmt = (
            sa.update(Complaint)
            .where(
                Complaint.id == complaint.id,
                Complaint.is_immutable == sa.false(),
                Complaint.status == ComplaintStatus.BORRADOR,
            )
            .values(
                tracking_code=tracking_code,
                submitted_at=submission_time,
                status=ComplaintStatus.ENVIADA,
                is_immutable=True,
                pdf_url=object_key,
            )
            .execution_options(synchronize_session=False)
        )
        try:
            claim_result = session.execute(claim_stmt)
        except IntegrityError:
            session.rollback()
            complaint = _get_complaint_or_404(session, complaint_id)
            _ensure_mutable_draft(complaint)
            continue

        if claim_result.rowcount != 1:
            session.rollback()
            complaint = _get_complaint_or_404(session, complaint_id)
            _ensure_mutable_draft(complaint)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Complaint state changed concurrently; cannot submit.",
            )

        complaint.tracking_code = tracking_code
        complaint.submitted_at = submission_time
        complaint.status = ComplaintStatus.ENVIADA
        complaint.is_immutable = True
        complaint.pdf_url = object_key

        try:
            with session.no_autoflush:
                pdf_bytes = render_complaint_pdf_bytes(
                    session=session,
                    complaint=complaint,
                    owner=current_user,
                    s3_client=s3_client,
                )
        except HTTPException:
            session.rollback()
            raise

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

        try:
            session.expire(complaint)
            session.commit()
            return _get_complaint_or_404(session, complaint_id)
        except IntegrityError:
            session.rollback()
            _cleanup_document_object(object_key=stored_key, s3_client=s3_client)
            complaint = _get_complaint_or_404(session, complaint_id)
            _ensure_mutable_draft(complaint)
            continue
        except SQLAlchemyError as exc:
            session.rollback()
            _cleanup_document_object(object_key=stored_key, s3_client=s3_client)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to finalize complaint submission.",
            ) from exc

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


def list_institutional_complaints(
    *,
    session: Session,
    main_type: OffenseMainType | None = None,
    category_id: int | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Complaint]:
    """List emitted immutable complaints for the University historical registry."""
    stmt = (
        select(Complaint)
        .where(Complaint.is_immutable == sa.true())
        .options(
            selectinload(Complaint.offense_category),  # type: ignore[arg-type]
            selectinload(Complaint.evidences),  # type: ignore[arg-type]
        )
    )
    if main_type is not None:
        stmt = stmt.join(OffenseCategory).where(OffenseCategory.main_type == main_type)
    if category_id is not None:
        stmt = stmt.where(Complaint.offense_category_id == category_id)
    if search is not None and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            sa.or_(
                sa.cast(Complaint.tracking_code, sa.String).ilike(term),
                sa.cast(Complaint.incident_address, sa.String).ilike(term),
            )
        )
    stmt = (
        stmt.order_by(sa.desc(Complaint.submitted_at))  # type: ignore[arg-type]
        .offset(offset)
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_institutional_complaint_stats(*, session: Session) -> ComplaintStatsRead:
    """Compute historical statistics of emitted complaints for the University admin panel."""
    categories = list(
        session.exec(select(OffenseCategory).order_by(sa.asc(OffenseCategory.id))).all()  # type: ignore[arg-type]
    )
    category_map = {category.id: category for category in categories}

    grouped_rows = session.exec(
        select(Complaint.offense_category_id, sa.func.count())
        .where(Complaint.is_immutable == sa.true())
        .group_by(Complaint.offense_category_id)
    ).all()

    total_submitted = 0
    total_maltrato = 0
    total_biocidio = 0
    by_category: list[ComplaintCategoryStat] = []

    for cat_id, raw_count in grouped_rows:
        count = int(raw_count)
        category = category_map.get(cat_id)
        if category is None:
            continue
        total_submitted += count
        if category.main_type == OffenseMainType.MALTRATO:
            total_maltrato += count
        else:
            total_biocidio += count
        by_category.append(
            ComplaintCategoryStat(
                category_id=cat_id,
                main_type=category.main_type,
                subtype_name=category.subtype_name,
                count=count,
            )
        )

    by_category.sort(key=lambda item: (-item.count, item.category_id))

    total_with_coordinates = int(
        session.exec(
            select(sa.func.count())
            .select_from(Complaint)
            .where(
                Complaint.is_immutable == sa.true(),
                sa.cast(Complaint.latitude, sa.Float).is_not(None),
                sa.cast(Complaint.longitude, sa.Float).is_not(None),
            )
        ).one()
    )
    total_photos = int(
        session.exec(
            select(sa.func.count())
            .select_from(ComplaintEvidence)
            .join(Complaint, ComplaintEvidence.complaint_id == Complaint.id)  # type: ignore[arg-type]
            .where(Complaint.is_immutable == sa.true())
        ).one()
    )

    return ComplaintStatsRead(
        total_submitted=total_submitted,
        total_maltrato=total_maltrato,
        total_biocidio=total_biocidio,
        total_with_coordinates=total_with_coordinates,
        total_photos=total_photos,
        by_category=by_category,
    )
