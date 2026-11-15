from collections.abc import Generator
from typing import Any
from uuid import uuid4

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
    UploadValidationError,
    create_s3_client,
    generate_presigned_upload,
    get_s3_client,
)
from app.main import app
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole


class StubS3Client:
    """In-memory S3 client stub recording presigned URL requests."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, object],
        ExpiresIn: int,
    ) -> str:
        self.calls.append(
            {
                "ClientMethod": ClientMethod,
                "Params": Params,
                "ExpiresIn": ExpiresIn,
            }
        )
        return f"https://minio.local/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Create an isolated in-memory SQLite session for API integration tests."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def stub_s3() -> StubS3Client:
    """Return a clean S3 stub instance."""
    return StubS3Client()


@pytest.fixture
def api_client(
    db_session: Session,
    stub_s3: StubS3Client,
) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient wired to the isolated DB session and S3 stub."""

    def override_get_session() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_s3_client] = lambda: stub_s3
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _create_user(
    session: Session,
    *,
    email: str,
    password: str = "SucreAnimal2026!",
    role: UserRole = UserRole.CIUDADANO,
    is_active: bool = True,
) -> User:
    user = User(
        full_name="Usuario Prueba",
        email=email,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


def test_register_citizen_normalizes_email_and_rejects_duplicates(
    api_client: TestClient,
) -> None:
    """Registration creates a citizen account, normalizes email, and returns 409 on conflict."""
    response = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "  Ana Pérez  ",
            "email": "Ana.Perez@Example.COM",
            "password": "MiPasswordSegura123",
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["full_name"] == "Ana Pérez"
    assert payload["email"] == "ana.perez@example.com"
    assert payload["role"] == "ciudadano"
    assert payload["is_active"] is True
    assert "password_hash" not in payload

    duplicate = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Otra Persona",
            "email": "ANA.PEREZ@example.com",
            "password": "OtroPassword123",
        },
    )
    assert duplicate.status_code == 409


def test_register_rejects_privilege_escalation_and_unsafe_inputs(
    api_client: TestClient,
) -> None:
    """Registration forbids extra fields like role, blank passwords, and HTML characters."""
    escalation = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Atacante",
            "email": "atacante@example.com",
            "password": "Password123!",
            "role": "admin",
        },
    )
    assert escalation.status_code == 422

    blank_password = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Ciudadano",
            "email": "espacios@example.com",
            "password": "        ",
        },
    )
    assert blank_password.status_code == 422

    html_name = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "<script>alert(1)</script>",
            "email": "xss@example.com",
            "password": "Password123!",
        },
    )
    assert html_name.status_code == 422


def test_login_oauth2_preserves_password_spaces_and_blocks_inactive_users(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """OAuth2 login normalizes emails, preserves password spaces, and blocks inactive users."""
    spaced_password = "  Clave Con Espacios 2026  "
    reg = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Carlos Rojas",
            "email": "carlos@example.com",
            "password": spaced_password,
        },
    )
    assert reg.status_code == 201

    ok_login = api_client.post(
        "/api/v1/auth/login",
        data={"username": "  CARLOS@Example.COM ", "password": spaced_password},
    )
    assert ok_login.status_code == 200
    token_data = ok_login.json()
    assert token_data["token_type"] == "bearer"
    assert isinstance(token_data["access_token"], str)

    wrong_pw = api_client.post(
        "/api/v1/auth/login",
        data={"username": "carlos@example.com", "password": "wrong"},
    )
    unknown_email = api_client.post(
        "/api/v1/auth/login",
        data={"username": "noexiste@example.com", "password": "wrong"},
    )
    assert wrong_pw.status_code == 401
    assert unknown_email.status_code == 401
    assert wrong_pw.json()["detail"] == unknown_email.json()["detail"]

    inactive = _create_user(
        db_session,
        email="inactivo@example.com",
        password="Password123!",
        is_active=False,
    )
    inactive_login = api_client.post(
        "/api/v1/auth/login",
        data={"username": inactive.email, "password": "Password123!"},
    )
    assert inactive_login.status_code == 401

    me_inactive = api_client.get("/api/v1/auth/me", headers=_auth_header(inactive))
    assert me_inactive.status_code == 401


def test_me_and_progressive_profile_validation(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Authenticated user can read and update legal profile without null-wiping or invalid data."""
    assert api_client.get("/api/v1/auth/me").status_code == 401

    citizen = _create_user(db_session, email="ciudadano@example.com")
    headers = _auth_header(citizen)

    me_resp = api_client.get("/api/v1/auth/me", headers=headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["ci_number"] is None

    patch_resp = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={
            "ci_number": " 7482910 CH ",
            "phone": "+591 71234567",
            "address": "Av. Hernando Siles N° 410, Sucre",
        },
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["ci_number"] == "7482910 CH"
    assert updated["phone"] == "+591 71234567"
    assert updated["address"] == "Av. Hernando Siles N° 410, Sucre"
    assert updated["full_name"] == "Usuario Prueba"

    null_wipe = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={"ci_number": None},
    )
    assert null_wipe.status_code == 422

    empty_patch = api_client.patch("/api/v1/auth/me/profile", headers=headers, json={})
    assert empty_patch.status_code == 422

    invalid_phone = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={"phone": "abc-no-valido"},
    )
    assert invalid_phone.status_code == 422

    refreshed = db_session.exec(select(User).where(User.id == citizen.id)).one()
    assert refreshed.ci_number == "7482910 CH"


def test_admin_role_assignment_rbac_and_self_demotion_guard(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Only admins can change roles, and admins cannot demote themselves."""
    citizen = _create_user(db_session, email="citizen1@example.com", role=UserRole.CIUDADANO)
    manager = _create_user(db_session, email="manager1@example.com", role=UserRole.GESTOR_CEMZOO)
    admin = _create_user(db_session, email="admin1@example.com", role=UserRole.ADMIN)

    for non_admin in (citizen, manager):
        forbidden = api_client.patch(
            f"/api/v1/auth/users/{citizen.id}/role",
            headers=_auth_header(non_admin),
            json={"role": "gestor_cemzoo"},
        )
        assert forbidden.status_code == 403

    promoted = api_client.patch(
        f"/api/v1/auth/users/{citizen.id}/role",
        headers=_auth_header(admin),
        json={"role": "gestor_cemzoo"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "gestor_cemzoo"

    self_demote = api_client.patch(
        f"/api/v1/auth/users/{admin.id}/role",
        headers=_auth_header(admin),
        json={"role": "ciudadano"},
    )
    assert self_demote.status_code == 400

    missing = api_client.patch(
        f"/api/v1/auth/users/{uuid4()}/role",
        headers=_auth_header(admin),
        json={"role": "gestor_cemzoo"},
    )
    assert missing.status_code == 404


def test_presigned_upload_enforces_auth_mime_size_and_bucket_rbac(
    api_client: TestClient,
    db_session: Session,
    stub_s3: StubS3Client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Presigned upload validates JWT, MIME whitelist, byte size limits, and bucket permissions."""
    unauth = api_client.post(
        "/api/v1/storage/presigned-upload",
        json={"mime_type": "image/jpeg", "file_size_bytes": 1024},
    )
    assert unauth.status_code == 401

    citizen = _create_user(db_session, email="uploader@example.com", role=UserRole.CIUDADANO)
    manager = _create_user(db_session, email="cemzoo-up@example.com", role=UserRole.GESTOR_CEMZOO)

    evidence_ok = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(citizen),
        json={"mime_type": " IMAGE/JPEG ", "file_size_bytes": 2048},
    )
    assert evidence_ok.status_code == 200
    ev_body = evidence_ok.json()
    assert ev_body["expires_in_seconds"] == PRESIGNED_UPLOAD_EXPIRY_SECONDS
    assert ev_body["object_key"].startswith("evidences/")
    assert ev_body["object_key"].endswith(".jpg")
    assert stub_s3.calls[-1]["Params"]["Bucket"] == "sos-evidences"

    bad_mime = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(citizen),
        json={"mime_type": "image/svg+xml", "file_size_bytes": 1024},
    )
    assert bad_mime.status_code == 415

    bool_size = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(citizen),
        json={"mime_type": "image/png", "file_size_bytes": True},
    )
    assert bool_size.status_code == 422

    with monkeypatch.context() as mp:
        mp.setenv("MAX_UPLOAD_SIZE_BYTES", "1024")
        get_settings.cache_clear()
        too_large = api_client.post(
            "/api/v1/storage/presigned-upload",
            headers=_auth_header(citizen),
            json={"mime_type": "image/png", "file_size_bytes": 2048},
        )
        assert too_large.status_code == 413
    get_settings.cache_clear()

    citizen_norm_denied = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(citizen),
        json={
            "mime_type": "application/pdf",
            "file_size_bytes": 1024,
            "purpose": "norm",
        },
    )
    assert citizen_norm_denied.status_code == 403

    norm_non_pdf = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(manager),
        json={
            "mime_type": "image/jpeg",
            "file_size_bytes": 1024,
            "purpose": "norm",
        },
    )
    assert norm_non_pdf.status_code == 415

    norm_ok = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(manager),
        json={
            "mime_type": "application/pdf",
            "file_size_bytes": 4096,
            "purpose": "norm",
        },
    )
    assert norm_ok.status_code == 200
    norm_body = norm_ok.json()
    assert norm_body["object_key"].startswith("norms/")
    assert norm_body["object_key"].endswith(".pdf")
    assert stub_s3.calls[-1]["Params"]["Bucket"] == "sos-documents"


def test_login_sanitizes_nul_bytes_oversized_passwords_and_idna_domains(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Login blocks PostgreSQL NUL-byte crashes, huge passwords, and supports IDNA aliases."""

    @sa.event.listens_for(db_session.bind, "before_cursor_execute")
    def reject_postgres_nul_bytes(
        _conn: object,
        _cursor: object,
        _statement: str,
        parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if any(isinstance(val, str) and "\x00" in val for val in values):
            raise AssertionError("NUL byte reached SQL query execution")

    reg = api_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Usuario IDNA",
            "email": "usuario@MÜNCHEN.de",
            "password": "Password123!",
        },
    )
    assert reg.status_code == 201
    assert reg.json()["email"] == "usuario@münchen.de"

    punycode_login = api_client.post(
        "/api/v1/auth/login",
        data={"username": "usuario@xn--mnchen-3ya.de", "password": "Password123!"},
    )
    assert punycode_login.status_code == 200

    nul_login = api_client.post(
        "/api/v1/auth/login",
        data={"username": "evil\x00@example.com", "password": "Password123!"},
    )
    assert nul_login.status_code == 401

    oversized_pw = api_client.post(
        "/api/v1/auth/login",
        data={"username": "usuario@münchen.de", "password": "A" * 500},
    )
    assert oversized_pw.status_code == 401


def test_schemas_reject_invisible_control_chars_and_garbage_ci_phone(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Auth schemas reject invisible/control Unicode, garbage CI/phone, and trim before bounds."""
    for bad_name in ("\u200b\u200b", "Ana\x7fPerez", "Ana\x85Perez", "Ana\u202ePerez"):
        res = api_client.post(
            "/api/v1/auth/register",
            json={
                "full_name": bad_name,
                "email": "safe-check@example.com",
                "password": "Password123!",
            },
        )
        assert res.status_code == 422

    for bad_pw in ("\x00" * 8, "\u200b" * 8, "Pass\nword123"):
        res = api_client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Nombre Válido",
                "email": "pw-check@example.com",
                "password": bad_pw,
            },
        )
        assert res.status_code == 422

    citizen = _create_user(db_session, email="profile-edge@example.com")
    headers = _auth_header(citizen)

    padded_max_name = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={"full_name": f"  {'a' * 150}  "},
    )
    assert padded_max_name.status_code == 200
    assert len(padded_max_name.json()["full_name"]) == 150

    for bad_ci in ("1--", "1     2", "1\u20282", "ABCD", "12-"):
        res = api_client.patch(
            "/api/v1/auth/me/profile",
            headers=headers,
            json={"ci_number": bad_ci},
        )
        assert res.status_code == 422

    for bad_phone in ("7-----1", "+1-----", "7     1", "7\u202812345", "12345+"):
        res = api_client.patch(
            "/api/v1/auth/me/profile",
            headers=headers,
            json={"phone": bad_phone},
        )
        assert res.status_code == 422

    for valid_ci in ("7482910-1A", "1234567-CH", "E-123456", "12345"):
        res = api_client.patch(
            "/api/v1/auth/me/profile",
            headers=headers,
            json={"ci_number": valid_ci},
        )
        assert res.status_code == 200

    valid_phone = api_client.patch(
        "/api/v1/auth/me/profile",
        headers=headers,
        json={"phone": "4-6451234"},
    )
    assert valid_phone.status_code == 200


def test_last_active_admin_cannot_be_demoted(db_session: Session) -> None:
    """Service refuses to demote the sole remaining active administrator."""
    sole_admin = _create_user(db_session, email="sole-admin@example.com", role=UserRole.ADMIN)
    stale_actor = User(
        id=uuid4(),
        full_name="Actor Remoto",
        email="stale-actor@example.com",
        password_hash=hash_password("Password123!"),
        role=UserRole.ADMIN,
    )

    with pytest.raises(HTTPException) as exc:
        auth_service.update_user_role(
            session=db_session,
            actor=stale_actor,
            target_user_id=sole_admin.id,
            new_role=UserRole.CIUDADANO,
        )
    assert exc.value.status_code == 400


def test_storage_hardening_empty_bucket_trimming_and_real_sigv4_headers(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Storage rejects empty buckets, trims MIME before bounds, caches S3 client, and signs PUT."""
    with pytest.raises(UploadValidationError) as empty_bucket_exc:
        generate_presigned_upload(
            mime_type="image/jpeg",
            file_size_bytes=512,
            bucket="",
        )
    assert empty_bucket_exc.value.status_code == 400

    manager = _create_user(db_session, email="norm-cfg@example.com", role=UserRole.GESTOR_CEMZOO)
    with monkeypatch.context() as mp:
        mp.setenv("MINIO_BUCKET_DOCUMENTS", "")
        get_settings.cache_clear()
        misconfigured = api_client.post(
            "/api/v1/storage/presigned-upload",
            headers=_auth_header(manager),
            json={
                "mime_type": "application/pdf",
                "file_size_bytes": 1024,
                "purpose": "norm",
            },
        )
        assert misconfigured.status_code == 500
    get_settings.cache_clear()

    padded_mime = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(manager),
        json={
            "mime_type": f"  image/jpeg{' ' * 95}",
            "file_size_bytes": 2048,
        },
    )
    assert padded_mime.status_code == 200

    blank_mime = api_client.post(
        "/api/v1/storage/presigned-upload",
        headers=_auth_header(manager),
        json={"mime_type": "   ", "file_size_bytes": 2048},
    )
    assert blank_mime.status_code == 422

    client_a = create_s3_client("http://localhost:9000")
    client_b = create_s3_client(" http://localhost:9000 ")
    assert client_a is client_b

    real_res = generate_presigned_upload(
        mime_type=" IMAGE/JPEG ",
        file_size_bytes=2048,
        client=client_a,
    )
    assert "X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost" in real_res.upload_url
    assert "X-Amz-Expires=180" in real_res.upload_url
