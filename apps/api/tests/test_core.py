from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import jwt as pyjwt
import pytest
import sqlalchemy as sa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import ValidationError
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.core.config import Settings, get_settings
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
    build_object_key,
    create_s3_client,
    generate_presigned_upload,
    validate_upload_metadata,
)
from app.modules.auth.models import User, UserRole
from app.modules.complaints.models import (
    Complaint,
    ComplaintEvidence,
    EvidenceType,
    OffenseCategory,
    OffenseMainType,
)


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
    assert stub.calls[0]["Params"]["ContentLength"] == 1024  # type: ignore[index]


def test_presigned_upload_rejects_disallowed_mime_and_invalid_sizes() -> None:
    """Verify disallowed MIME types and out-of-bounds sizes raise UploadValidationError."""
    stub = FakeS3Client()

    with pytest.raises(UploadValidationError) as mime_exc:
        generate_presigned_upload(mime_type="text/html", file_size_bytes=500, client=stub)
    assert mime_exc.value.status_code == 415

    with pytest.raises(UploadValidationError) as empty_exc:
        generate_presigned_upload(mime_type="image/jpeg", file_size_bytes=0, client=stub)
    assert empty_exc.value.status_code == 400

    with pytest.raises(UploadValidationError) as bool_exc:
        generate_presigned_upload(mime_type="image/jpeg", file_size_bytes=True, client=stub)
    assert bool_exc.value.status_code == 400

    with pytest.raises(UploadValidationError) as large_exc:
        generate_presigned_upload(
            mime_type="video/mp4",
            file_size_bytes=100 * 1024 * 1024,
            client=stub,
        )
    assert large_exc.value.status_code == 413


def test_storage_prefix_sanitization_and_runtime_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify prefix traversal rejection and dynamic runtime limit evaluation."""
    with pytest.raises(UploadValidationError):
        build_object_key("", "image/jpeg")
    with pytest.raises(UploadValidationError):
        build_object_key("../secrets", "image/jpeg")
    with pytest.raises(UploadValidationError) as mime_exc:
        build_object_key("evidences", "image/svg+xml")
    assert mime_exc.value.status_code == 415

    monkeypatch.setenv("MAX_UPLOAD_SIZE_BYTES", "100")
    get_settings.cache_clear()
    try:
        with pytest.raises(UploadValidationError) as limit_exc:
            validate_upload_metadata("image/jpeg", 500)
        assert limit_exc.value.status_code == 413
    finally:
        get_settings.cache_clear()

    https_client = create_s3_client("https://minio.example.com")
    assert https_client._endpoint.host.startswith("https://")  # type: ignore[attr-defined]


def test_settings_rejects_insecure_production_secret_key() -> None:
    """Ensure staging and production environments reject default or weak SECRET_KEY."""
    with pytest.raises(ValidationError):
        Settings(ENVIRONMENT="production")

    with pytest.raises(ValidationError):
        Settings(ENVIRONMENT="staging", SECRET_KEY="short-key")

    valid_prod = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="a-very-strong-production-secret-key-over-32-chars",
    )
    assert valid_prod.ENVIRONMENT == "production"


def test_security_hardening_edge_cases() -> None:
    """Verify malformed hashes, empty passwords, and invalid JWT claims are safely rejected."""
    assert verify_password("secret", "not-a-valid-hash") is False
    assert verify_password("secret", "") is False

    with pytest.raises(ValueError):
        hash_password("")

    settings_obj = get_settings()
    empty_sub_token = create_access_token(subject="", role=UserRole.CIUDADANO)
    with pytest.raises(ValueError):
        decode_access_token(empty_sub_token)

    bogus_role_token = pyjwt.encode(
        {
            "sub": str(uuid4()),
            "role": "super_root",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        settings_obj.SECRET_KEY,
        algorithm=settings_obj.JWT_ALGORITHM,
    )
    with pytest.raises(ValueError):
        decode_access_token(bogus_role_token)

    bool_exp_token = pyjwt.encode(
        {"sub": str(uuid4()), "role": "admin", "exp": True},
        settings_obj.SECRET_KEY,
        algorithm=settings_obj.JWT_ALGORITHM,
    )
    with pytest.raises(ValueError):
        decode_access_token(bool_exp_token)

    with pytest.raises(ValueError):
        require_role([])
    with pytest.raises(ValueError):
        require_role(["invalid_role"])


def test_complaint_cascade_delete_removes_evidences() -> None:
    """Verify deleting a draft complaint cascades cleanly to ComplaintEvidence rows."""
    engine = create_engine("sqlite://")

    @sa.event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection: object, _record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        user = User(
            full_name="Denunciante Prueba",
            email="denunciante@example.com",
            password_hash=hash_password("secret123"),
        )
        category = OffenseCategory(
            main_type=OffenseMainType.MALTRATO,
            subtype_name="Maltrato físico",
            legal_basis="Art. 350 bis C.P.",
        )
        session.add(user)
        session.add(category)
        session.commit()
        session.refresh(user)
        session.refresh(category)
        assert category.id is not None

        complaint = Complaint(
            user_id=user.id,
            offense_category_id=category.id,
            incident_date=datetime.now(UTC),
            incident_address="Sucre",
            description="Prueba de cascada",
        )
        session.add(complaint)
        session.commit()
        session.refresh(complaint)

        evidence = ComplaintEvidence(
            complaint_id=complaint.id,
            evidence_type=EvidenceType.FOTO,
            object_key="evidences/cascade-test.jpg",
            mime_type="image/jpeg",
            file_size_bytes=1024,
        )
        session.add(evidence)
        session.commit()

        session.delete(complaint)
        session.commit()

        remaining = session.exec(select(ComplaintEvidence)).all()
        assert remaining == []


def test_complaint_pdf_template_uses_correct_legal_terminology() -> None:
    """Ensure PDF template uses 'Documento de Denuncia', escapes HTML, and omits 'Memorial'."""
    templates_dir = Path(__file__).resolve().parents[1] / "app" / "templates"
    content = (templates_dir / "complaint_pdf.html").read_text(encoding="utf-8")
    assert "DOCUMENTO DE DENUNCIA" in content
    assert "memorial" not in content.lower()

    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    rendered = env.get_template("complaint_pdf.html").render(
        tracking_code="SOS-000001-2026",
        submitted_at="2026-11-13 17:00 UTC",
        full_name="María Pérez",
        ci_number="1234567-CH",
        phone="71234567",
        address="Calle Bolívar N.º 123",
        main_type="MALTRATO",
        subtype_name="Maltrato físico",
        legal_basis="Art. 350 bis C.P.",
        incident_date="2026-11-13 14:30",
        incident_address="Plaza 25 de Mayo",
        latitude=-19.0478,
        longitude=-65.2596,
        description='<img src="file:///etc/passwd">',
        evidences=[],
    )
    assert "-19.0478, -65.2596" in rendered
    assert '<img src="file:///etc/passwd">' not in rendered
    assert "&lt;img src=&#34;file:///etc/passwd&#34;&gt;" in rendered
