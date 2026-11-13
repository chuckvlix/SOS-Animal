from collections.abc import Generator
from datetime import timedelta
from pathlib import Path
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.database import get_session
from app.core.dependencies import require_role
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.core.storage import (
    ALLOWED_EVIDENCE_MIME_TYPES,
    PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    UploadValidationError,
    generate_presigned_upload,
)
from app.modules.auth.models import User, UserRole


class FakeS3Client:
    """In-memory S3 client stub verifying presigned URL generation calls."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, object],
        ExpiresIn: int,
    ) -> str:
        self.calls.append({"ClientMethod": ClientMethod, "Params": Params, "ExpiresIn": ExpiresIn})
        return f"https://minio.local/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"


def test_password_hashing_and_verification() -> None:
    """Verify Argon2 password hashing produces verifiable non-plaintext digests."""
    plain = "SucreAnimal2026!"
    hashed = hash_password(plain)
    assert hashed != plain
    assert hashed.startswith("$argon2")
    assert verify_password(plain, hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_jwt_token_creation_and_expiration() -> None:
    """Ensure JWT tokens encode subject/role and reject expired tokens."""
    token = create_access_token(subject="user-123", role=UserRole.CIUDADANO)
    payload = decode_access_token(token)
    assert payload.sub == "user-123"
    assert payload.role == UserRole.CIUDADANO

    expired_token = create_access_token(
        subject="user-123",
        role=UserRole.CIUDADANO,
        expires_delta=timedelta(seconds=-5),
    )
    with pytest.raises(ValueError):
        decode_access_token(expired_token)


def test_require_role_rbac_enforcement() -> None:
    """Ensure require_role blocks unauthorized roles with 403 and allows permitted roles."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    citizen = User(
        full_name="Ciudadano Prueba",
        email="ciudadano@example.com",
        password_hash=hash_password("secret123"),
        role=UserRole.CIUDADANO,
    )
    manager = User(
        full_name="Gestor CEMZOO",
        email="cemzoo@example.com",
        password_hash=hash_password("secret123"),
        role=UserRole.GESTOR_CEMZOO,
    )

    with Session(engine) as session:
        session.add(citizen)
        session.add(manager)
        session.commit()
        session.refresh(citizen)
        session.refresh(manager)
        citizen_id = str(citizen.id)
        manager_id = str(manager.id)

    test_app = FastAPI()

    def override_get_session() -> Generator[Session, None, None]:
        with Session(engine) as session:
            yield session

    test_app.dependency_overrides[get_session] = override_get_session

    @test_app.get("/protected")
    def protected_route(
        user: Annotated[User, Depends(require_role([UserRole.ADMIN, UserRole.GESTOR_CEMZOO]))],
    ) -> dict[str, str]:
        return {"role": user.role}

    client = TestClient(test_app)

    unauthenticated = client.get("/protected")
    assert unauthenticated.status_code == 401

    citizen_token = create_access_token(subject=citizen_id, role=UserRole.CIUDADANO)
    forbidden = client.get(
        "/protected",
        headers={"Authorization": f"Bearer {citizen_token}"},
    )
    assert forbidden.status_code == 403

    manager_token = create_access_token(subject=manager_id, role=UserRole.GESTOR_CEMZOO)
    allowed = client.get(
        "/protected",
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"role": "gestor_cemzoo"}


@pytest.mark.parametrize("mime_type", sorted(ALLOWED_EVIDENCE_MIME_TYPES))
def test_presigned_upload_allows_whitelisted_mime_types(mime_type: str) -> None:
    """Verify presigned upload accepts whitelisted MIME types and enforces 180s expiry."""
    stub = FakeS3Client()
    result = generate_presigned_upload(
        mime_type=mime_type,
        file_size_bytes=1024,
        client=stub,
    )
    assert result.expires_in_seconds == PRESIGNED_UPLOAD_EXPIRY_SECONDS
    assert result.expires_in_seconds == 180
    assert result.object_key.startswith("evidences/")
    assert stub.calls[0]["ExpiresIn"] == 180
    assert stub.calls[0]["ClientMethod"] == "put_object"


def test_presigned_upload_rejects_disallowed_mime_and_invalid_sizes() -> None:
    """Verify disallowed MIME types and out-of-bounds sizes raise UploadValidationError."""
    stub = FakeS3Client()

    with pytest.raises(UploadValidationError) as mime_exc:
        generate_presigned_upload(mime_type="text/html", file_size_bytes=500, client=stub)
    assert mime_exc.value.status_code == 415

    with pytest.raises(UploadValidationError) as empty_exc:
        generate_presigned_upload(mime_type="image/jpeg", file_size_bytes=0, client=stub)
    assert empty_exc.value.status_code == 400

    with pytest.raises(UploadValidationError) as large_exc:
        generate_presigned_upload(
            mime_type="video/mp4",
            file_size_bytes=100 * 1024 * 1024,
            client=stub,
        )
    assert large_exc.value.status_code == 413


def test_complaint_pdf_template_uses_correct_legal_terminology() -> None:
    """Ensure legal PDF template uses 'Documento de Denuncia' and never 'Memorial'."""
    template_path = Path(__file__).resolve().parents[1] / "app" / "templates" / "complaint_pdf.html"
    content = template_path.read_text(encoding="utf-8")
    assert "DOCUMENTO DE DENUNCIA" in content
    assert "memorial" not in content.lower()
