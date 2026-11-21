"""Integration and unit tests for the Zoonosis and veterinary directory module."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.database import get_session
from app.core.security import create_access_token, hash_password
from app.main import app
from app.modules.auth.models import User, UserRole
from app.modules.directory.models import AttentionCenter, CenterCategory
from app.modules.directory.service import calculate_haversine_distance


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Create an isolated in-memory SQLite session for tests."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient bound to the isolated session."""

    def override_get_session() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _create_user(
    session: Session,
    *,
    email: str,
    role: UserRole = UserRole.CIUDADANO,
) -> User:
    user = User(
        full_name="Usuario de Prueba",
        email=email,
        password_hash=hash_password("PasswordSegura2026!"),
        role=role,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


def _seed_attention_center(
    session: Session,
    *,
    name: str = "Centro Zoonosis Sucre",
    category: CenterCategory = CenterCategory.ZOONOSIS,
    address: str = "Av. Circunvalación s/n",
    latitude: float = -19.0300,
    longitude: float = -65.2600,
    phone: str | None = "4-6451234",
    opening_hours: str = "Lun-Vie 08:00 - 16:00",
    is_24_hours: bool = False,
    services: str = "Vacunación antirrábica gratuita y esterilización",
    is_active: bool = True,
) -> AttentionCenter:
    center = AttentionCenter(
        name=name,
        category=category,
        address=address,
        latitude=latitude,
        longitude=longitude,
        phone=phone,
        opening_hours=opening_hours,
        is_24_hours=is_24_hours,
        services=services,
        is_active=is_active,
    )
    session.add(center)
    session.commit()
    session.refresh(center)
    return center


def test_haversine_distance_calculation() -> None:
    """Verify haversine formula correctly computes great-circle distance."""
    # Distance from a point to itself must be 0.0
    zero_dist = calculate_haversine_distance(-19.0478, -65.2596, -19.0478, -65.2596)
    assert zero_dist == 0.0

    # Distance between Plaza 25 de Mayo (-19.0478, -65.2596) and CEMZOO (-19.0200, -65.2750)
    dist = calculate_haversine_distance(-19.0478, -65.2596, -19.0200, -65.2750)
    assert 3.0 < dist < 4.0  # Approx 3.48 km


def test_public_list_empty_and_seeded(client: TestClient, db_session: Session) -> None:
    """Ensure public listing returns empty list initially and includes seeded centers."""
    resp = client.get("/api/v1/directory/")
    assert resp.status_code == 200
    assert resp.json() == []

    _seed_attention_center(db_session, name="CEMZOO Sucre")
    _seed_attention_center(
        db_session,
        name="Clínica Vet San Roque",
        category=CenterCategory.VETERINARIA,
        is_24_hours=True,
    )

    resp = client.get("/api/v1/directory/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert any(c["name"] == "CEMZOO Sucre" for c in data)
    assert any(c["name"] == "Clínica Vet San Roque" for c in data)


def test_public_list_filtering(client: TestClient, db_session: Session) -> None:
    """Verify filters by category, 24-hours, search query, and active status."""
    _seed_attention_center(
        db_session,
        name="Centro Municipal Zoonosis",
        category=CenterCategory.ZOONOSIS,
        is_24_hours=False,
        services="Campañas de vacunación canina",
        is_active=True,
    )
    _seed_attention_center(
        db_session,
        name="Clínica Urgencias 24h Huellitas",
        category=CenterCategory.VETERINARIA,
        is_24_hours=True,
        services="Cirugías y emergencias nocturnas",
        is_active=True,
    )
    _seed_attention_center(
        db_session,
        name="Veterinaria Antigua Inactiva",
        category=CenterCategory.VETERINARIA,
        is_24_hours=False,
        is_active=False,
    )

    # Filter by category
    resp_zoo = client.get("/api/v1/directory/?category=ZOONOSIS")
    assert resp_zoo.status_code == 200
    assert len(resp_zoo.json()) == 1
    assert resp_zoo.json()[0]["category"] == "ZOONOSIS"

    # Filter by 24h emergency
    resp_24h = client.get("/api/v1/directory/?is_24_hours=true")
    assert resp_24h.status_code == 200
    assert len(resp_24h.json()) == 1
    assert resp_24h.json()[0]["is_24_hours"] is True

    # Search by text query
    resp_q = client.get("/api/v1/directory/?q=emergencias")
    assert resp_q.status_code == 200
    assert len(resp_q.json()) == 1
    assert "Huellitas" in resp_q.json()[0]["name"]

    # Filter active (default true hides inactive)
    resp_active = client.get("/api/v1/directory/")
    assert len(resp_active.json()) == 2
    assert all(c["is_active"] for c in resp_active.json())

    # Include inactive
    resp_all = client.get("/api/v1/directory/?is_active=false")
    assert len(resp_all.json()) == 1
    assert resp_all.json()[0]["name"] == "Veterinaria Antigua Inactiva"


def test_public_list_with_user_distance_sorting(
    client: TestClient, db_session: Session
) -> None:
    """Verify proximity calculations and distance-based sorting."""
    # Near center: Plaza 25 de Mayo (-19.0478, -65.2596)
    c_close = _seed_attention_center(
        db_session,
        name="Vet Centro Plaza",
        latitude=-19.0480,
        longitude=-65.2598,
    )
    # Far center: approx 4km away
    c_far = _seed_attention_center(
        db_session,
        name="Vet Salida Tarabuco",
        latitude=-19.0100,
        longitude=-65.2300,
    )

    # Providing only user_lat without user_lng must fail with 400
    resp_bad = client.get("/api/v1/directory/?user_lat=-19.0478")
    assert resp_bad.status_code == 400

    # Providing both coordinates
    resp = client.get("/api/v1/directory/?user_lat=-19.0478&user_lng=-65.2596")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2

    first = data[0]
    second = data[1]

    assert first["id"] == c_close.id
    assert first["distance_km"] is not None
    assert first["distance_km"] < 0.1  # very close

    assert second["id"] == c_far.id
    assert second["distance_km"] is not None
    assert second["distance_km"] > first["distance_km"]


def test_get_center_by_id(client: TestClient, db_session: Session) -> None:
    """Verify single center lookup by ID."""
    center = _seed_attention_center(db_session, name="Zoonosis Central")

    resp = client.get(f"/api/v1/directory/{center.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == center.id
    assert resp.json()["name"] == "Zoonosis Central"

    resp_404 = client.get("/api/v1/directory/99999")
    assert resp_404.status_code == 404


def test_admin_create_center_and_rbac(
    client: TestClient, db_session: Session
) -> None:
    """Verify creation authorization and data validation."""
    admin = _create_user(db_session, email="admin@usfx.bo", role=UserRole.ADMIN)
    citizen = _create_user(db_session, email="citizen@correo.bo", role=UserRole.CIUDADANO)

    payload = {
        "name": "Clínica Veterinaria Universitaria USFX",
        "category": "VETERINARIA",
        "address": "Calle Calvo 123",
        "latitude": -19.0450,
        "longitude": -65.2580,
        "phone": "64-55555",
        "opening_hours": "08:00 - 20:00",
        "is_24_hours": True,
        "services": "Cirugía general, laboratorio, ecografía y atención de urgencia",
        "is_active": True,
    }

    # Anonymous request -> 401
    resp_anon = client.post("/api/v1/directory/", json=payload)
    assert resp_anon.status_code == 401

    # Citizen request -> 403
    resp_cit = client.post("/api/v1/directory/", json=payload, headers=_auth_header(citizen))
    assert resp_cit.status_code == 403

    # Admin request -> 201 Created
    resp_admin = client.post("/api/v1/directory/", json=payload, headers=_auth_header(admin))
    assert resp_admin.status_code == 201
    created_data = resp_admin.json()
    assert created_data["id"] is not None
    assert created_data["name"] == payload["name"]
    assert created_data["is_24_hours"] is True


def test_admin_update_center_and_rbac(
    client: TestClient, db_session: Session
) -> None:
    """Verify update endpoints require admin role and mutate data correctly."""
    admin = _create_user(db_session, email="admin2@usfx.bo", role=UserRole.ADMIN)
    citizen = _create_user(db_session, email="citizen2@correo.bo", role=UserRole.CIUDADANO)
    center = _seed_attention_center(db_session, name="Vet Original")

    update_payload = {
        "name": "Vet Modificada 24 Horas",
        "is_24_hours": True,
        "phone": "77788899",
    }

    # Citizen forbidden -> 403
    resp_cit = client.patch(
        f"/api/v1/directory/{center.id}",
        json=update_payload,
        headers=_auth_header(citizen),
    )
    assert resp_cit.status_code == 403

    # Admin success -> 200
    resp_admin = client.patch(
        f"/api/v1/directory/{center.id}",
        json=update_payload,
        headers=_auth_header(admin),
    )
    assert resp_admin.status_code == 200
    data = resp_admin.json()
    assert data["name"] == "Vet Modificada 24 Horas"
    assert data["is_24_hours"] is True
    assert data["phone"] == "77788899"


def test_admin_delete_center_and_rbac(
    client: TestClient, db_session: Session
) -> None:
    """Verify deletion requires admin role and removes the resource."""
    admin = _create_user(db_session, email="admin3@usfx.bo", role=UserRole.ADMIN)
    citizen = _create_user(db_session, email="citizen3@correo.bo", role=UserRole.CIUDADANO)
    center = _seed_attention_center(db_session, name="Vet para Borrar")

    # Citizen forbidden -> 403
    resp_cit = client.delete(
        f"/api/v1/directory/{center.id}",
        headers=_auth_header(citizen),
    )
    assert resp_cit.status_code == 403

    # Admin delete -> 204 No Content
    resp_admin = client.delete(
        f"/api/v1/directory/{center.id}",
        headers=_auth_header(admin),
    )
    assert resp_admin.status_code == 204

    # Verification: should now be 404
    resp_get = client.get(f"/api/v1/directory/{center.id}")
    assert resp_get.status_code == 404
