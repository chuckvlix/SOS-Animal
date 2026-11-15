"""Unit and integration tests for the complaints module and immutable PDF lifecycle."""

import sys
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.core.config import get_settings
from app.core.database import get_session
from app.core.security import create_access_token, hash_password
from app.core.storage import (
    PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    get_internal_s3_client,
    get_s3_client,
)
from app.main import app
from app.modules.auth.models import User, UserRole
from app.modules.complaints import service as complaints_service
from app.modules.complaints.models import (
    Complaint,
    ComplaintEvidence,
    ComplaintStatus,
    OffenseCategory,
    OffenseMainType,
)


class StubS3Client:
    """In-memory S3 client stub supporting presigned URLs and PDF object uploads."""

    def __init__(self, endpoint_label: str = "https://minio.local") -> None:
        self.endpoint_label = endpoint_label
        self.presigned_calls: list[dict[str, Any]] = []
        self.uploaded_objects: dict[tuple[str, str], dict[str, Any]] = {}

    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, object],
        ExpiresIn: int,
    ) -> str:
        """Record presigned GET/PUT URL generation calls."""
        self.presigned_calls.append(
            {
                "ClientMethod": ClientMethod,
                "Params": Params,
                "ExpiresIn": ExpiresIn,
            }
        )
        return (
            f"{self.endpoint_label}/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"
        )

    def put_object(
        self,
        *,
        Bucket: str,
        Key: str,
        Body: bytes,
        ContentType: str,
    ) -> dict[str, object]:
        """Record uploaded document bytes in memory."""
        self.uploaded_objects[(Bucket, Key)] = {
            "Body": Body,
            "ContentType": ContentType,
        }
        return {"ETag": '"stub-etag"'}


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Create an isolated SQLite session with foreign keys enforced."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @sa.event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection: Any, _record: object) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def public_s3() -> StubS3Client:
    """Return a clean public-endpoint S3 stub."""
    return StubS3Client("http://localhost:9000")


@pytest.fixture
def internal_s3() -> StubS3Client:
    """Return a clean internal-endpoint S3 stub."""
    return StubS3Client("http://storage:9000")


@pytest.fixture
def api_client(
    db_session: Session,
    public_s3: StubS3Client,
    internal_s3: StubS3Client,
) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient wired to isolated DB session and S3 stubs."""

    def override_get_session() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_s3_client] = lambda: public_s3
    app.dependency_overrides[get_internal_s3_client] = lambda: internal_s3
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _create_user(
    session: Session,
    *,
    email: str,
    full_name: str = "Ciudadano Denunciante",
    ci_number: str | None = "7654321 CH",
    phone: str | None = "+591 71112222",
    address: str | None = "Av. Hernando Siles 123, Sucre",
    role: UserRole = UserRole.CIUDADANO,
) -> User:
    user = User(
        email=email,
        password_hash=hash_password("StrongPass123!"),
        full_name=full_name,
        ci_number=ci_number,
        phone=phone,
        address=address,
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role.value)
    return {"Authorization": f"Bearer {token}"}


def _past_iso(hours_ago: int = 2) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours_ago)).isoformat()


def _create_draft_via_api(
    client: TestClient,
    headers: dict[str, str],
    category_id: int,
    *,
    address: str = "Calle Loa 450, Zona Central",
    description: str = "Perro atado sin agua ni sombra desde hace tres dias continuos.",
    latitude: float | None = -19.0478,
    longitude: float | None = -65.2596,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/complaints",
        headers=headers,
        json={
            "offense_category_id": category_id,
            "incident_date": _past_iso(),
            "incident_address": address,
            "latitude": latitude,
            "longitude": longitude,
            "description": description,
        },
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_categories_seeded_idempotently_and_filterable(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Catalog returns 13 statutory categories (8 MALTRATO, 5 BIOCIDIO) without duplicates."""
    first = api_client.get("/api/v1/complaints/categories")
    assert first.status_code == 200
    all_categories = first.json()
    assert len(all_categories) == 13

    complaints_service.ensure_offense_categories_seeded(db_session)
    second = api_client.get("/api/v1/complaints/categories")
    assert second.status_code == 200
    assert len(second.json()) == 13

    maltrato = api_client.get(
        "/api/v1/complaints/categories",
        params={"main_type": "MALTRATO"},
    )
    biocidio = api_client.get(
        "/api/v1/complaints/categories",
        params={"main_type": "BIOCIDIO"},
    )
    assert maltrato.status_code == 200
    assert biocidio.status_code == 200
    assert len(maltrato.json()) == 8
    assert len(biocidio.json()) == 5
    assert all("350 bis" in item["legal_basis"] for item in maltrato.json())
    assert all("350 ter" in item["legal_basis"] for item in biocidio.json())


def test_draft_crud_validation_and_ownership_isolation(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Draft lifecycle enforces auth, coordinate pairing, non-future dates, and ownership."""
    unauth = api_client.get("/api/v1/complaints/me")
    assert unauth.status_code == 401

    categories = api_client.get("/api/v1/complaints/categories").json()
    category_id = categories[0]["id"]

    owner = _create_user(db_session, email="owner@example.com")
    other = _create_user(db_session, email="other@example.com")
    owner_headers = _auth_headers(owner)
    other_headers = _auth_headers(other)

    half_coords = api_client.post(
        "/api/v1/complaints",
        headers=owner_headers,
        json={
            "offense_category_id": category_id,
            "incident_date": _past_iso(),
            "incident_address": "Av. Jaime Mendoza 200",
            "latitude": -19.04,
            "description": "Relato valido de maltrato sin longitud emparejada.",
        },
    )
    assert half_coords.status_code == 422

    future_date = api_client.post(
        "/api/v1/complaints",
        headers=owner_headers,
        json={
            "offense_category_id": category_id,
            "incident_date": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "incident_address": "Av. Jaime Mendoza 200",
            "description": "Relato valido con fecha futura rechazada.",
        },
    )
    assert future_date.status_code == 422

    html_xss = api_client.post(
        "/api/v1/complaints",
        headers=owner_headers,
        json={
            "offense_category_id": category_id,
            "incident_date": _past_iso(),
            "incident_address": "Av. Jaime Mendoza 200",
            "description": "Texto con <script>alert(1)</script> bloqueado.",
        },
    )
    assert html_xss.status_code == 422

    missing_cat = api_client.post(
        "/api/v1/complaints",
        headers=owner_headers,
        json={
            "offense_category_id": 999999,
            "incident_date": _past_iso(),
            "incident_address": "Av. Jaime Mendoza 200",
            "description": "Categoria inexistente debe responder 404.",
        },
    )
    assert missing_cat.status_code == 404

    draft = _create_draft_via_api(api_client, owner_headers, category_id)
    draft_id = draft["id"]
    assert draft["status"] == "BORRADOR"
    assert draft["is_immutable"] is False
    assert draft["tracking_code"] is None
    assert draft["offense_category"]["id"] == category_id

    my_list = api_client.get("/api/v1/complaints/me", headers=owner_headers)
    assert my_list.status_code == 200
    assert [item["id"] for item in my_list.json()] == [draft_id]

    assert (
        api_client.get(f"/api/v1/complaints/{draft_id}", headers=other_headers).status_code == 403
    )
    assert (
        api_client.patch(
            f"/api/v1/complaints/{draft_id}",
            headers=other_headers,
            json={"incident_address": "Intento ajeno"},
        ).status_code
        == 403
    )
    assert (
        api_client.delete(f"/api/v1/complaints/{draft_id}", headers=other_headers).status_code
        == 403
    )

    empty_patch = api_client.patch(
        f"/api/v1/complaints/{draft_id}",
        headers=owner_headers,
        json={},
    )
    assert empty_patch.status_code == 422

    updated = api_client.patch(
        f"/api/v1/complaints/{draft_id}",
        headers=owner_headers,
        json={
            "incident_address": "Calle Aniceto Arce 888",
            "latitude": None,
            "longitude": None,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["incident_address"] == "Calle Aniceto Arce 888"
    assert updated.json()["latitude"] is None
    assert updated.json()["longitude"] is None

    deleted = api_client.delete(f"/api/v1/complaints/{draft_id}", headers=owner_headers)
    assert deleted.status_code == 204
    assert (
        api_client.get(f"/api/v1/complaints/{draft_id}", headers=owner_headers).status_code == 404
    )


def test_evidence_validation_dedup_and_deletion(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Evidence endpoint validates MIME whitelist, key extension, duplicates, and deletion."""
    category_id = api_client.get("/api/v1/complaints/categories").json()[0]["id"]
    owner = _create_user(db_session, email="evidence@example.com")
    headers = _auth_headers(owner)
    draft = _create_draft_via_api(api_client, headers, category_id)
    draft_id = draft["id"]

    photo_key = f"evidences/{uuid4()}.jpg"
    bad_mime = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "text/plain",
            "file_size_bytes": 1024,
        },
    )
    assert bad_mime.status_code == 415

    oversized = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 50 * 1024 * 1024,
        },
    )
    assert oversized.status_code == 413

    mismatched_type = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "VIDEO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 2048,
        },
    )
    assert mismatched_type.status_code == 422

    mismatched_ext = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": f"evidences/{uuid4()}.png",
            "mime_type": "image/jpeg",
            "file_size_bytes": 2048,
        },
    )
    assert mismatched_ext.status_code == 422

    bad_prefix = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": f"complaints/{uuid4()}.jpg",
            "mime_type": "image/jpeg",
            "file_size_bytes": 2048,
        },
    )
    assert bad_prefix.status_code == 422

    attached = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 4096,
        },
    )
    assert attached.status_code == 201
    evidence_id = attached.json()["id"]

    duplicate = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 4096,
        },
    )
    assert duplicate.status_code == 409

    removed = api_client.delete(
        f"/api/v1/complaints/{draft_id}/evidences/{evidence_id}",
        headers=headers,
    )
    assert removed.status_code == 204
    assert db_session.exec(select(ComplaintEvidence)).all() == []


def test_submit_requires_complete_profile_then_locks_immutability_and_generates_pdf(
    api_client: TestClient,
    db_session: Session,
    public_s3: StubS3Client,
    internal_s3: StubS3Client,
) -> None:
    """Submission enforces progressive profile, uploads PDF to MinIO, and freezes mutations."""
    category_id = api_client.get("/api/v1/complaints/categories").json()[8]["id"]
    incomplete_user = _create_user(
        db_session,
        email="incomplete@example.com",
        ci_number="8899001 CH",
        phone=None,
        address=None,
    )
    headers = _auth_headers(incomplete_user)
    draft = _create_draft_via_api(api_client, headers, category_id)
    draft_id = draft["id"]

    evidence_resp = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "DOCUMENTO",
            "object_key": f"evidences/{uuid4()}.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 8192,
        },
    )
    assert evidence_resp.status_code == 201
    evidence_id = evidence_resp.json()["id"]

    preview = api_client.get(f"/api/v1/complaints/{draft_id}/preview", headers=headers)
    assert preview.status_code == 200
    preview_data = preview.json()
    assert preview_data["title"] == "DOCUMENTO DE DENUNCIA"
    assert "DOCUMENTO DE DENUNCIA" in preview_data["html_preview"]
    assert "memorial" not in preview_data["html_preview"].lower()

    pdf_before_submit = api_client.get(f"/api/v1/complaints/{draft_id}/pdf", headers=headers)
    assert pdf_before_submit.status_code == 409

    blocked_submit = api_client.post(f"/api/v1/complaints/{draft_id}/submit", headers=headers)
    assert blocked_submit.status_code == 400
    assert "phone" in blocked_submit.json()["detail"]
    assert "address" in blocked_submit.json()["detail"]

    profile_patch = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={
            "full_name": "Ciudadano Denunciante Completo",
            "ci_number": "8899001 CH",
            "phone": "+591 72223344",
            "address": "Calle Dalence 77, Sucre",
        },
    )
    assert profile_patch.status_code == 200

    submitted = api_client.post(f"/api/v1/complaints/{draft_id}/submit", headers=headers)
    assert submitted.status_code == 200, submitted.text
    sub_data = submitted.json()
    year = datetime.now(UTC).year
    assert sub_data["status"] == "ENVIADA"
    assert sub_data["is_immutable"] is True
    assert sub_data["tracking_code"] == f"SOS-000001-{year}"
    assert sub_data["pdf_url"] == f"complaints/{draft_id}/SOS-000001-{year}.pdf"
    assert sub_data["submitted_at"] is not None

    uploaded = internal_s3.uploaded_objects[("sos-documents", sub_data["pdf_url"])]
    assert uploaded["ContentType"] == "application/pdf"
    assert uploaded["Body"].startswith(b"%PDF-")

    assert (
        api_client.patch(
            f"/api/v1/complaints/{draft_id}",
            headers=headers,
            json={"incident_address": "Cambio bloqueado tras envio"},
        ).status_code
        == 409
    )
    assert api_client.delete(f"/api/v1/complaints/{draft_id}", headers=headers).status_code == 409
    assert (
        api_client.post(
            f"/api/v1/complaints/{draft_id}/evidences",
            headers=headers,
            json={
                "evidence_type": "FOTO",
                "object_key": f"evidences/{uuid4()}.jpg",
                "mime_type": "image/jpeg",
                "file_size_bytes": 1024,
            },
        ).status_code
        == 409
    )
    assert (
        api_client.delete(
            f"/api/v1/complaints/{draft_id}/evidences/{evidence_id}",
            headers=headers,
        ).status_code
        == 409
    )
    assert (
        api_client.post(f"/api/v1/complaints/{draft_id}/submit", headers=headers).status_code == 409
    )

    download = api_client.get(f"/api/v1/complaints/{draft_id}/pdf", headers=headers)
    assert download.status_code == 200
    dl_data = download.json()
    assert dl_data["object_key"] == sub_data["pdf_url"]
    assert dl_data["expires_in_seconds"] == PRESIGNED_UPLOAD_EXPIRY_SECONDS
    assert public_s3.presigned_calls[-1]["ClientMethod"] == "get_object"
    assert public_s3.presigned_calls[-1]["Params"]["Bucket"] == "sos-documents"
    assert public_s3.presigned_calls[-1]["ExpiresIn"] == 180

    other_citizen = _create_user(db_session, email="intruder@example.com")
    assert (
        api_client.get(
            f"/api/v1/complaints/{draft_id}/pdf",
            headers=_auth_headers(other_citizen),
        ).status_code
        == 403
    )


def test_public_tracking_institutional_workflow_and_sequential_codes(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Public tracking hides PII while CEMZOO/Admin can filter and transition statuses."""
    categories = api_client.get("/api/v1/complaints/categories").json()
    maltrato_id = categories[0]["id"]
    biocidio_id = categories[8]["id"]

    citizen = _create_user(db_session, email="reporter@example.com")
    cemzoo = _create_user(db_session, email="cemzoo@example.com", role=UserRole.GESTOR_CEMZOO)
    citizen_headers = _auth_headers(citizen)
    cemzoo_headers = _auth_headers(cemzoo)

    draft_one = _create_draft_via_api(api_client, citizen_headers, maltrato_id)
    draft_two = _create_draft_via_api(api_client, citizen_headers, biocidio_id)
    draft_pending = _create_draft_via_api(api_client, citizen_headers, maltrato_id)

    sub_one = api_client.post(
        f"/api/v1/complaints/{draft_one['id']}/submit",
        headers=citizen_headers,
    ).json()
    sub_two = api_client.post(
        f"/api/v1/complaints/{draft_two['id']}/submit",
        headers=citizen_headers,
    ).json()

    year = datetime.now(UTC).year
    assert sub_one["tracking_code"] == f"SOS-000001-{year}"
    assert sub_two["tracking_code"] == f"SOS-000002-{year}"

    track_ok = api_client.get(f"/api/v1/complaints/track/{sub_one['tracking_code'].lower()}")
    assert track_ok.status_code == 200
    tracked = track_ok.json()
    assert tracked["tracking_code"] == sub_one["tracking_code"]
    assert tracked["status"] == "ENVIADA"
    assert tracked["main_type"] == "MALTRATO"
    for pii_field in ("full_name", "ci_number", "phone", "address", "description", "pdf_url"):
        assert pii_field not in tracked

    assert api_client.get(f"/api/v1/complaints/track/SOS-999999-{year}").status_code == 404
    assert api_client.get("/api/v1/complaints/track/INVALID-CODE").status_code == 422

    assert api_client.get("/api/v1/complaints", headers=citizen_headers).status_code == 403
    assert (
        api_client.patch(
            f"/api/v1/complaints/{sub_one['id']}/status",
            headers=citizen_headers,
            json={"status": "EN_ATENCION_CEMZOO"},
        ).status_code
        == 403
    )

    institutional_all = api_client.get("/api/v1/complaints", headers=cemzoo_headers)
    assert institutional_all.status_code == 200
    returned_ids = {item["id"] for item in institutional_all.json()}
    assert returned_ids == {sub_one["id"], sub_two["id"]}
    assert draft_pending["id"] not in returned_ids

    filtered_bio = api_client.get(
        "/api/v1/complaints",
        headers=cemzoo_headers,
        params={"status": "ENVIADA", "main_type": "BIOCIDIO"},
    )
    assert filtered_bio.status_code == 200
    assert [item["id"] for item in filtered_bio.json()] == [sub_two["id"]]

    draft_transition = api_client.patch(
        f"/api/v1/complaints/{draft_pending['id']}/status",
        headers=cemzoo_headers,
        json={"status": "EN_ATENCION_CEMZOO"},
    )
    assert draft_transition.status_code == 409

    step_one = api_client.patch(
        f"/api/v1/complaints/{sub_one['id']}/status",
        headers=cemzoo_headers,
        json={"status": "EN_ATENCION_CEMZOO"},
    )
    assert step_one.status_code == 200
    assert step_one.json()["status"] == "EN_ATENCION_CEMZOO"

    step_two = api_client.patch(
        f"/api/v1/complaints/{sub_one['id']}/status",
        headers=cemzoo_headers,
        json={"status": "CERRADA"},
    )
    assert step_two.status_code == 200
    assert step_two.json()["status"] == "CERRADA"

    invalid_reopen = api_client.patch(
        f"/api/v1/complaints/{sub_one['id']}/status",
        headers=cemzoo_headers,
        json={"status": "EN_ATENCION_CEMZOO"},
    )
    assert invalid_reopen.status_code == 409

    cemzoo_pdf = api_client.get(
        f"/api/v1/complaints/{sub_one['id']}/pdf",
        headers=cemzoo_headers,
    )
    assert cemzoo_pdf.status_code == 200


def test_render_pdf_passes_restricted_url_fetcher_and_strict_staging_errors(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WeasyPrint invocation disables URL fetching, and staging rejects missing libs with 500."""
    complaints_service.ensure_offense_categories_seeded(db_session)
    category = db_session.exec(select(OffenseCategory)).first()
    assert category is not None
    assert category.id is not None

    user = _create_user(db_session, email="pdfrender@example.com")
    complaint = Complaint(
        user_id=user.id,
        offense_category_id=category.id,
        incident_date=datetime.now(UTC) - timedelta(hours=1),
        incident_address="Plaza 25 de Mayo 10",
        description="Descripcion formal suficiente para generar el documento PDF.",
        tracking_code="SOS-000001-2026",
        status=ComplaintStatus.ENVIADA,
        is_immutable=True,
        submitted_at=datetime.now(UTC),
    )
    db_session.add(complaint)
    db_session.commit()
    db_session.refresh(complaint)
    assert isinstance(complaint.id, UUID)
    assert category.main_type in {OffenseMainType.MALTRATO, OffenseMainType.BIOCIDIO}

    captured: dict[str, Any] = {}

    class FakeHTML:
        def __init__(self, *, string: str, url_fetcher: Any) -> None:
            captured["string"] = string
            captured["url_fetcher"] = url_fetcher

        def write_pdf(self) -> bytes:
            return b"%PDF-1.4\n%rendered\n%%EOF\n"

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=FakeHTML))
    rendered = complaints_service.render_complaint_pdf_bytes(
        session=db_session,
        complaint=complaint,
        owner=user,
    )
    assert rendered.startswith(b"%PDF-1.4")
    assert "DOCUMENTO DE DENUNCIA" in captured["string"]
    assert "memorial" not in captured["string"].lower()
    assert captured["url_fetcher"] is complaints_service._restricted_url_fetcher

    with pytest.raises(ValueError, match="disabled"):
        captured["url_fetcher"]("https://attacker.example/ssrf.png")

    class MissingLibHTML:
        def __init__(self, *, string: str, url_fetcher: Any) -> None:
            raise OSError("cannot load library 'libgobject-2.0-0'")

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=MissingLibHTML))
    try:
        with monkeypatch.context() as scoped:
            scoped.setenv("ENVIRONMENT", "staging")
            scoped.setenv("SECRET_KEY", "staging-test-secret-key-with-32-plus-chars")
            get_settings.cache_clear()
            with pytest.raises(HTTPException) as exc_info:
                complaints_service.render_complaint_pdf_bytes(
                    session=db_session,
                    complaint=complaint,
                    owner=user,
                )
            assert exc_info.value.status_code == 500
    finally:
        get_settings.cache_clear()
