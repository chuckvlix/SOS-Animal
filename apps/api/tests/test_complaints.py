"""Unit and integration tests for the complaints module and immutable PDF lifecycle."""

import base64
import io
import sys
import threading
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from botocore.exceptions import ClientError
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
    EvidenceType,
    OffenseCategory,
    OffenseMainType,
)


class StubS3Client:
    """In-memory S3 client stub supporting presigned URLs, uploads, HEAD checks, and deletes."""

    def __init__(self, endpoint_label: str = "https://minio.local") -> None:
        self.endpoint_label = endpoint_label
        self.presigned_calls: list[dict[str, Any]] = []
        self.uploaded_objects: dict[tuple[str, str], dict[str, Any]] = {}
        self.deleted_keys: list[tuple[str, str]] = []

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

    def head_object(
        self,
        *,
        Bucket: str,
        Key: str,
    ) -> dict[str, object]:
        """Return object metadata or raise S3 404 ClientError when absent."""
        stored = self.uploaded_objects.get((Bucket, Key))
        if stored is None:
            raise ClientError(
                {
                    "Error": {"Code": "404", "Message": "Not Found"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "HeadObject",
            )
        return {
            "ContentLength": len(stored["Body"]),
            "ContentType": stored["ContentType"],
        }

    def delete_object(
        self,
        *,
        Bucket: str,
        Key: str,
    ) -> dict[str, object]:
        """Delete an object from memory and record the deletion call."""
        self.deleted_keys.append((Bucket, Key))
        self.uploaded_objects.pop((Bucket, Key), None)
        return {}

    def get_object(
        self,
        *,
        Bucket: str,
        Key: str,
    ) -> dict[str, Any]:
        """Return stored object bytes stream or raise S3 404 ClientError when absent."""
        stored = self.uploaded_objects.get((Bucket, Key))
        if stored is None:
            raise ClientError(
                {
                    "Error": {"Code": "404", "Message": "Not Found"},
                    "ResponseMetadata": {"HTTPStatusCode": 404},
                },
                "GetObject",
            )
        return {
            "Body": io.BytesIO(stored["Body"]),
            "ContentType": stored["ContentType"],
        }


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


def _seed_evidence_in_s3(
    s3_client: StubS3Client,
    *,
    object_key: str,
    mime_type: str = "image/jpeg",
    size_bytes: int = 4096,
    body: bytes | None = None,
    bucket: str = "sos-evidences",
) -> None:
    payload = body if body is not None else b"x" * size_bytes
    s3_client.put_object(
        Bucket=bucket,
        Key=object_key,
        Body=payload,
        ContentType=mime_type,
    )


def _attach_photo_via_api(
    client: TestClient,
    headers: dict[str, str],
    s3_client: StubS3Client,
    draft_id: str,
    *,
    mime_type: str = "image/jpeg",
    ext: str = ".jpg",
    payload: bytes = b"\xff\xd8\xff\xe0stub-photo-bytes",
) -> dict[str, Any]:
    object_key = f"evidences/{uuid4()}{ext}"
    _seed_evidence_in_s3(
        s3_client,
        object_key=object_key,
        mime_type=mime_type,
        body=payload,
    )
    resp = client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": object_key,
            "mime_type": mime_type,
            "file_size_bytes": len(payload),
        },
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


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
    internal_s3: StubS3Client,
) -> None:
    """Evidence endpoint validates MIME, S3 existence, size parity, dedup, and cleanup."""
    category_id = api_client.get("/api/v1/complaints/categories").json()[0]["id"]
    owner = _create_user(db_session, email="evidence@example.com")
    headers = _auth_headers(owner)
    draft = _create_draft_via_api(api_client, headers, category_id)
    draft_id = draft["id"]

    photo_key = f"evidences/{uuid4()}.jpg"
    ghost_evidence = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 4096,
        },
    )
    assert ghost_evidence.status_code == 422

    _seed_evidence_in_s3(internal_s3, object_key=photo_key, mime_type="image/jpeg", size_bytes=4096)

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

    mismatched_size = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": photo_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 1234,
        },
    )
    assert mismatched_size.status_code == 422

    wrong_s3_mime_key = f"evidences/{uuid4()}.jpg"
    _seed_evidence_in_s3(
        internal_s3,
        object_key=wrong_s3_mime_key,
        mime_type="image/png",
        size_bytes=2048,
    )
    spoofed_mime = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": wrong_s3_mime_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 2048,
        },
    )
    assert spoofed_mime.status_code == 422

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

    disallowed_doc = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "DOCUMENTO",
            "object_key": f"evidences/{uuid4()}.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 2048,
        },
    )
    assert disallowed_doc.status_code == 422

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
    assert ("sos-evidences", photo_key) in internal_s3.deleted_keys

    orphan_key = f"evidences/{uuid4()}.webp"
    _seed_evidence_in_s3(
        internal_s3,
        object_key=orphan_key,
        mime_type="image/webp",
        size_bytes=512,
    )
    attached_for_draft_del = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": orphan_key,
            "mime_type": "image/webp",
            "file_size_bytes": 512,
        },
    )
    assert attached_for_draft_del.status_code == 201

    _attach_photo_via_api(
        api_client, headers, internal_s3, draft_id, mime_type="image/png", ext=".png"
    )
    _attach_photo_via_api(
        api_client, headers, internal_s3, draft_id, mime_type="image/jpeg", ext=".jpg"
    )

    fourth_key = f"evidences/{uuid4()}.jpg"
    _seed_evidence_in_s3(internal_s3, object_key=fourth_key, mime_type="image/jpeg", size_bytes=512)
    fourth_denied = api_client.post(
        f"/api/v1/complaints/{draft_id}/evidences",
        headers=headers,
        json={
            "evidence_type": "FOTO",
            "object_key": fourth_key,
            "mime_type": "image/jpeg",
            "file_size_bytes": 512,
        },
    )
    assert fourth_denied.status_code == 409

    assert api_client.delete(f"/api/v1/complaints/{draft_id}", headers=headers).status_code == 204
    assert ("sos-evidences", orphan_key) in internal_s3.deleted_keys


def test_submit_requires_complete_profile_then_locks_immutability_and_generates_pdf(
    api_client: TestClient,
    db_session: Session,
    public_s3: StubS3Client,
    internal_s3: StubS3Client,
) -> None:
    """Enforce 1-3 photos and complete profile, embed photo annex, and freeze draft."""
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

    png_bytes = b"\x89PNG\r\n\x1a\nstub-png-payload"
    attached_photo = _attach_photo_via_api(
        api_client,
        headers,
        internal_s3,
        draft_id,
        mime_type="image/png",
        ext=".png",
        payload=png_bytes,
    )
    evidence_id = attached_photo["id"]
    expected_b64 = base64.b64encode(png_bytes).decode("ascii")

    preview = api_client.get(f"/api/v1/complaints/{draft_id}/preview", headers=headers)
    assert preview.status_code == 200
    preview_data = preview.json()
    assert preview_data["title"] == "DOCUMENTO DE DENUNCIA"
    assert "DOCUMENTO DE DENUNCIA" in preview_data["html_preview"]
    assert "VI. Anexo Fotográfico" in preview_data["html_preview"]
    assert f"data:image/png;base64,{expected_b64}" in preview_data["html_preview"]
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

    draft_no_photos = _create_draft_via_api(api_client, headers, category_id)
    blocked_no_photos = api_client.post(
        f"/api/v1/complaints/{draft_no_photos['id']}/submit",
        headers=headers,
    )
    assert blocked_no_photos.status_code == 400
    assert "photographs" in blocked_no_photos.json()["detail"]

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


def test_admin_historical_registry_stats_and_removed_tracking_routes(
    api_client: TestClient,
    db_session: Session,
    internal_s3: StubS3Client,
) -> None:
    """Admin views historical complaints & stats; tracking and status transitions are removed."""
    categories = api_client.get("/api/v1/complaints/categories").json()
    maltrato_id = categories[0]["id"]
    biocidio_id = categories[8]["id"]

    citizen = _create_user(db_session, email="reporter@example.com")
    admin = _create_user(db_session, email="admin-panel@example.com", role=UserRole.ADMIN)
    citizen_headers = _auth_headers(citizen)
    admin_headers = _auth_headers(admin)

    draft_one = _create_draft_via_api(
        api_client,
        citizen_headers,
        maltrato_id,
        address="Av. Las Americas 210",
    )
    _attach_photo_via_api(api_client, citizen_headers, internal_s3, draft_one["id"])
    _attach_photo_via_api(api_client, citizen_headers, internal_s3, draft_one["id"])

    draft_two = _create_draft_via_api(
        api_client,
        citizen_headers,
        biocidio_id,
        address="Mercado Campesino Sector B",
        latitude=None,
        longitude=None,
    )
    _attach_photo_via_api(api_client, citizen_headers, internal_s3, draft_two["id"])

    draft_pending = _create_draft_via_api(api_client, citizen_headers, maltrato_id)
    _attach_photo_via_api(api_client, citizen_headers, internal_s3, draft_pending["id"])

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

    assert api_client.get(f"/api/v1/complaints/track/{sub_one['tracking_code']}").status_code == 404
    assert (
        api_client.patch(
            f"/api/v1/complaints/{sub_one['id']}/status",
            headers=admin_headers,
            json={"status": "ENVIADA"},
        ).status_code
        in {404, 405}
    )

    assert api_client.get("/api/v1/complaints", headers=citizen_headers).status_code == 403
    assert api_client.get("/api/v1/complaints/stats", headers=citizen_headers).status_code == 403

    institutional_all = api_client.get("/api/v1/complaints", headers=admin_headers)
    assert institutional_all.status_code == 200
    returned_ids = {item["id"] for item in institutional_all.json()}
    assert returned_ids == {sub_one["id"], sub_two["id"]}
    assert draft_pending["id"] not in returned_ids

    filtered_bio = api_client.get(
        "/api/v1/complaints",
        headers=admin_headers,
        params={"main_type": "BIOCIDIO"},
    )
    assert filtered_bio.status_code == 200
    assert [item["id"] for item in filtered_bio.json()] == [sub_two["id"]]

    filtered_search = api_client.get(
        "/api/v1/complaints",
        headers=admin_headers,
        params={"search": "americas", "category_id": maltrato_id},
    )
    assert filtered_search.status_code == 200
    assert [item["id"] for item in filtered_search.json()] == [sub_one["id"]]

    stats_resp = api_client.get("/api/v1/complaints/stats", headers=admin_headers)
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["total_submitted"] == 2
    assert stats["total_maltrato"] == 1
    assert stats["total_biocidio"] == 1
    assert stats["total_with_coordinates"] == 1
    assert stats["total_photos"] == 3
    assert {item["category_id"]: item["count"] for item in stats["by_category"]} == {
        maltrato_id: 1,
        biocidio_id: 1,
    }

    admin_pdf = api_client.get(
        f"/api/v1/complaints/{sub_one['id']}/pdf",
        headers=admin_headers,
    )
    assert admin_pdf.status_code == 200


def test_render_pdf_passes_restricted_url_fetcher_and_strict_staging_errors(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WeasyPrint blocks SSRF URLs while embedding allowed base64 image data URIs."""
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

    photo_key = f"evidences/{uuid4()}.png"
    png_bytes = b"\x89PNG\r\n\x1a\nfake-png-content"
    s3 = StubS3Client()
    _seed_evidence_in_s3(
        s3,
        object_key=photo_key,
        mime_type="image/png",
        body=png_bytes,
    )
    ev = ComplaintEvidence(
        complaint_id=complaint.id,
        evidence_type=EvidenceType.FOTO,
        object_key=photo_key,
        mime_type="image/png",
        file_size_bytes=len(png_bytes),
    )
    db_session.add(ev)
    db_session.commit()
    db_session.refresh(complaint)

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
        s3_client=s3,
    )
    assert rendered.startswith(b"%PDF-1.4")
    assert "DOCUMENTO DE DENUNCIA" in captured["string"]
    assert "VI. Anexo Fotográfico" in captured["string"]
    expected_b64 = base64.b64encode(png_bytes).decode("ascii")
    assert f"data:image/png;base64,{expected_b64}" in captured["string"]
    assert "memorial" not in captured["string"].lower()
    assert captured["url_fetcher"] is complaints_service._restricted_url_fetcher
    assert captured["url_fetcher"]._fail_on_errors is False
    assert "white-space: pre-wrap" in captured["string"]

    for blocked_url in (
        "https://attacker.example/ssrf.png",
        "file:///etc/passwd",
        "data:text/html,<script>alert(1)</script>",
        "data:image/svg+xml;base64,PHN2Zz4=",
    ):
        with pytest.raises(ValueError, match="disabled"):
            captured["url_fetcher"](blocked_url)

    fetcher_calls: list[dict[str, Any]] = []

    class FakeURLFetcher:
        def __init__(self, *, allowed_protocols: set[str], fail_on_errors: bool) -> None:
            self.allowed_protocols = allowed_protocols
            self.fail_on_errors = fail_on_errors

        def fetch(self, url: str) -> dict[str, Any]:
            fetcher_calls.append(
                {
                    "allowed_protocols": self.allowed_protocols,
                    "fail_on_errors": self.fail_on_errors,
                    "url": url,
                }
            )
            return {"mime_type": "image/png"}

    monkeypatch.setitem(
        sys.modules,
        "weasyprint.urls",
        SimpleNamespace(URLFetcher=FakeURLFetcher),
    )
    data_uri = f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"
    fetched = captured["url_fetcher"](data_uri)
    assert fetched == {"mime_type": "image/png"}
    assert fetcher_calls == [
        {
            "allowed_protocols": {"data"},
            "fail_on_errors": False,
            "url": data_uri,
        }
    ]

    class MissingLibHTML:
        def __init__(self, *, string: str, url_fetcher: Any) -> None:
            raise OSError("cannot load library 'libgobject-2.0-0'")

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=MissingLibHTML))
    fallback_pdf = complaints_service.render_complaint_pdf_bytes(
        session=db_session,
        complaint=complaint,
        owner=user,
        s3_client=s3,
    )
    assert fallback_pdf.startswith(b"%PDF-1.4")
    assert fallback_pdf.endswith(b"%%EOF\n")
    fallback_text = fallback_pdf.decode("latin-1", "replace")
    assert "350 bis" in fallback_text
    assert "ANEXO FOTOGRAFICO" in fallback_text
    assert "Descripcion formal suficiente para generar el documento PDF." in fallback_text

    class DiskFailureHTML:
        def __init__(self, *, string: str, url_fetcher: Any) -> None:
            raise PermissionError("unexpected permission failure")

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=DiskFailureHTML))
    with pytest.raises(HTTPException) as disk_exc:
        complaints_service.render_complaint_pdf_bytes(
            session=db_session,
            complaint=complaint,
            owner=user,
        )
    assert disk_exc.value.status_code == 500

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


def test_multiline_description_padding_rejected_and_lists_paginated(
    api_client: TestClient,
    db_session: Session,
    internal_s3: StubS3Client,
) -> None:
    """Reject whitespace/newline-padded short descriptions and paginate list endpoints."""
    categories = api_client.get("/api/v1/complaints/categories").json()
    category_id = categories[0]["id"]
    citizen = _create_user(db_session, email="pagination@example.com")
    admin = _create_user(db_session, email="admin-pag@example.com", role=UserRole.ADMIN)
    c_headers = _auth_headers(citizen)
    a_headers = _auth_headers(admin)

    padded_desc = api_client.post(
        "/api/v1/complaints",
        headers=c_headers,
        json={
            "offense_category_id": category_id,
            "incident_date": _past_iso(),
            "incident_address": "Calle Junin 123, Sucre",
            "description": "a\n\n\n\n\n\n\n\nb",
        },
    )
    assert padded_desc.status_code == 422

    for idx in range(3):
        created = _create_draft_via_api(
            api_client,
            c_headers,
            category_id,
            address=f"Calle Paginacion {idx + 10}",
        )
        _attach_photo_via_api(api_client, c_headers, internal_s3, created["id"])
        submitted = api_client.post(f"/api/v1/complaints/{created['id']}/submit", headers=c_headers)
        assert submitted.status_code == 200

    page_me = api_client.get(
        "/api/v1/complaints/me",
        headers=c_headers,
        params={"limit": 2, "offset": 1},
    )
    assert page_me.status_code == 200
    assert len(page_me.json()) == 2

    page_admin = api_client.get(
        "/api/v1/complaints",
        headers=a_headers,
        params={"limit": 1, "offset": 2},
    )
    assert page_admin.status_code == 200
    assert len(page_admin.json()) == 1


def test_submit_resists_concurrent_race_conditions(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Concurrent double-submit and correlative code retry guarantee single immutable emission."""
    db_file = tmp_path / "race.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    SQLModel.metadata.create_all(engine)
    s3 = StubS3Client("http://storage:9000")

    class FakeHTML:
        def __init__(self, *, string: str, url_fetcher: Any) -> None:
            pass

        def write_pdf(self) -> bytes:
            return b"%PDF-1.4\n%ok\n%%EOF\n"

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(HTML=FakeHTML))

    with Session(engine) as session:
        complaints_service.ensure_offense_categories_seeded(session)
        cat = session.exec(select(OffenseCategory)).first()
        assert cat is not None and cat.id is not None
        cat_id = cat.id
        citizen = _create_user(session, email="race-citizen@example.com")
        draft = complaints_service.create_draft_complaint(
            session=session,
            current_user=citizen,
            payload=complaints_service.ComplaintCreateRequest(
                offense_category_id=cat_id,
                incident_date=datetime.now(UTC) - timedelta(hours=1),
                incident_address="Plaza 25 de Mayo 100",
                description="Relato valido para prueba de concurrencia en envio y correlativo.",
            ),
        )
        draft_id = draft.id
        citizen_id = citizen.id
        photo_one = f"evidences/{uuid4()}.jpg"
        _seed_evidence_in_s3(s3, object_key=photo_one, mime_type="image/jpeg", body=b"jpg-one")
        session.add(
            ComplaintEvidence(
                complaint_id=draft_id,
                evidence_type=EvidenceType.FOTO,
                object_key=photo_one,
                mime_type="image/jpeg",
                file_size_bytes=7,
            )
        )
        session.commit()

    barrier = threading.Barrier(2)
    submit_outcomes: list[tuple[str, Any]] = []

    def worker_submit() -> None:
        with Session(engine) as session:
            owner = session.get(User, citizen_id)
            assert owner is not None
            barrier.wait(timeout=5)
            try:
                out = complaints_service.submit_complaint(
                    session=session,
                    current_user=owner,
                    complaint_id=draft_id,
                    s3_client=s3,
                )
                submit_outcomes.append(("OK", out.tracking_code))
            except HTTPException as exc:
                submit_outcomes.append(("ERR", exc.status_code))

    t1 = threading.Thread(target=worker_submit)
    t2 = threading.Thread(target=worker_submit)
    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    assert sorted(submit_outcomes) == [("ERR", 409), ("OK", f"SOS-000001-{datetime.now(UTC).year}")]
    expected_key = f"complaints/{draft_id}/SOS-000001-{datetime.now(UTC).year}.pdf"
    assert ("sos-documents", expected_key) in s3.uploaded_objects

    # Verify IntegrityError collision retry skips taken code without uploading orphan PDFs
    with Session(engine) as session:
        owner = session.get(User, citizen_id)
        assert owner is not None
        second_draft = complaints_service.create_draft_complaint(
            session=session,
            current_user=owner,
            payload=complaints_service.ComplaintCreateRequest(
                offense_category_id=cat_id,
                incident_date=datetime.now(UTC) - timedelta(hours=1),
                incident_address="Parque Bolivar 50",
                description=(
                    "Linea de relato extensa para probar paginacion fallback. " * 25
                ).strip(),
            ),
        )
        second_id = second_draft.id
        photo_two = f"evidences/{uuid4()}.png"
        _seed_evidence_in_s3(s3, object_key=photo_two, mime_type="image/png", body=b"png-two")
        session.add(
            ComplaintEvidence(
                complaint_id=second_id,
                evidence_type=EvidenceType.FOTO,
                object_key=photo_two,
                mime_type="image/png",
                file_size_bytes=7,
            )
        )
        session.commit()

    call_count = {"n": 0}
    orig_next_seq = complaints_service._next_tracking_sequence

    def stale_first_seq(*, session: Session, year: int) -> int:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return 1  # Collides with SOS-000001 already committed
        return orig_next_seq(session=session, year=year)

    monkeypatch.setattr(complaints_service, "_next_tracking_sequence", stale_first_seq)
    s3_before = len(s3.uploaded_objects)
    with Session(engine) as session:
        owner = session.get(User, citizen_id)
        assert owner is not None
        retried = complaints_service.submit_complaint(
            session=session,
            current_user=owner,
            complaint_id=second_id,
            s3_client=s3,
        )
        year = datetime.now(UTC).year
        assert retried.tracking_code == f"SOS-000002-{year}"
        assert retried.pdf_url == f"complaints/{second_id}/SOS-000002-{year}.pdf"
    assert len(s3.uploaded_objects) == s3_before + 1
    orphan_pdf_key = f"complaints/{second_id}/SOS-000001-{year}.pdf"
    assert ("sos-documents", orphan_pdf_key) not in s3.uploaded_objects
