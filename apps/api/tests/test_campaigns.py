"""Integration tests for the public campaigns listing and admin-only campaign management."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.core.database import get_session
from app.core.security import create_access_token, hash_password
from app.main import app
from app.modules.auth.models import User, UserRole

BASE_START = "2027-01-10T09:00:00+00:00"
BASE_END = "2027-01-10T17:00:00+00:00"


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
def api_client(db_session: Session) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient wired to the isolated DB session."""

    def override_get_session() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _create_user(
    session: Session,
    *,
    email: str,
    full_name: str = "Usuario Campanas",
    role: UserRole = UserRole.CIUDADANO,
) -> User:
    user = User(
        email=email,
        password_hash=hash_password("StrongPass123!"),
        full_name=full_name,
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role.value)
    return {"Authorization": f"Bearer {token}"}


def _payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": "Jornada de vacunación antirrábica",
        "campaign_type": "CALENDARIO_VACUNACION",
        "description": "Vacunación gratuita para perros y gatos en la plaza principal.",
        "requirements": "Llevar carnet de vacunación y mascota con collar.",
        "location_address": "Plaza 25 de Mayo, Sucre",
        "latitude": -19.0478,
        "longitude": -65.2596,
        "start_date": BASE_START,
        "end_date": BASE_END,
        "institution": "Universidad San Francisco Xavier",
    }
    payload.update(overrides)
    return payload


def _create_campaign(
    client: TestClient,
    headers: dict[str, str],
    **overrides: Any,
) -> dict[str, Any]:
    response = client.post("/api/v1/campaigns", headers=headers, json=_payload(**overrides))
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_public_list_detail_ordering_and_type_filter(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Public endpoints expose campaigns ordered by start_date and filterable by type."""
    admin = _create_user(db_session, email="campaigns-admin@example.com", role=UserRole.ADMIN)
    headers = _auth_headers(admin)

    third = _create_campaign(
        api_client,
        headers,
        title="Tercera jornada",
        campaign_type="PROXIMA_JORNADA",
        start_date="2027-03-01T09:00:00+00:00",
        end_date="2027-03-01T17:00:00+00:00",
    )
    first = _create_campaign(
        api_client,
        headers,
        title="Primera jornada",
        campaign_type="CALENDARIO_VACUNACION",
        start_date="2027-01-15T09:00:00+00:00",
        end_date="2027-01-15T17:00:00+00:00",
    )
    second = _create_campaign(
        api_client,
        headers,
        title="Segunda jornada",
        campaign_type="CAMPANA_ESTERILIZACION",
        start_date="2027-02-10T09:00:00+00:00",
        end_date="2027-02-10T17:00:00+00:00",
    )

    listing = api_client.get("/api/v1/campaigns")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [first["id"], second["id"], third["id"]]

    filtered = api_client.get(
        "/api/v1/campaigns",
        params={"campaign_type": "CAMPANA_ESTERILIZACION"},
    )
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()] == [second["id"]]

    paged = api_client.get("/api/v1/campaigns", params={"limit": 1, "offset": 1})
    assert paged.status_code == 200
    assert [item["id"] for item in paged.json()] == [second["id"]]

    detail = api_client.get(f"/api/v1/campaigns/{first['id']}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Primera jornada"
    assert detail.json()["campaign_type"] == "CALENDARIO_VACUNACION"

    assert api_client.get("/api/v1/campaigns/999999").status_code == 404
    assert api_client.get("/api/v1/campaigns", params={"limit": 0}).status_code == 422
    assert api_client.get("/api/v1/campaigns", params={"offset": -1}).status_code == 422


def test_active_only_excludes_finished_campaigns(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """active_only keeps ongoing and future campaigns while excluding ended ones."""
    admin = _create_user(db_session, email="active-admin@example.com", role=UserRole.ADMIN)
    headers = _auth_headers(admin)
    now = datetime.now(UTC)

    past = _create_campaign(
        api_client,
        headers,
        title="Jornada pasada",
        start_date=(now - timedelta(days=30)).isoformat(),
        end_date=(now - timedelta(days=1)).isoformat(),
    )
    current = _create_campaign(
        api_client,
        headers,
        title="Jornada vigente",
        start_date=(now - timedelta(days=1)).isoformat(),
        end_date=(now + timedelta(days=7)).isoformat(),
    )
    future = _create_campaign(
        api_client,
        headers,
        title="Jornada futura",
        start_date=(now + timedelta(days=10)).isoformat(),
        end_date=(now + timedelta(days=20)).isoformat(),
    )

    all_campaigns = api_client.get("/api/v1/campaigns")
    assert all_campaigns.status_code == 200
    assert [item["id"] for item in all_campaigns.json()] == [
        past["id"],
        current["id"],
        future["id"],
    ]

    active = api_client.get("/api/v1/campaigns", params={"active_only": "true"})
    assert active.status_code == 200
    assert [item["id"] for item in active.json()] == [current["id"], future["id"]]


def test_create_campaign_rbac_and_server_side_created_by(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Only admins can create campaigns and created_by is always the authenticated admin."""
    payload = _payload()
    assert api_client.post("/api/v1/campaigns", json=payload).status_code == 401

    citizen = _create_user(db_session, email="campaign-citizen@example.com")
    admin = _create_user(db_session, email="campaign-admin@example.com", role=UserRole.ADMIN)
    citizen_headers = _auth_headers(citizen)
    admin_headers = _auth_headers(admin)

    assert (
        api_client.post("/api/v1/campaigns", headers=citizen_headers, json=payload).status_code
        == 403
    )

    created = api_client.post("/api/v1/campaigns", headers=admin_headers, json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["created_by"] == str(admin.id)
    assert body["title"] == payload["title"]

    assert (
        api_client.patch(
            f"/api/v1/campaigns/{body['id']}",
            headers=citizen_headers,
            json={"title": "Intento ciudadano"},
        ).status_code
        == 403
    )
    assert (
        api_client.put(
            f"/api/v1/campaigns/{body['id']}",
            headers=citizen_headers,
            json=payload,
        ).status_code
        == 403
    )
    assert (
        api_client.delete(f"/api/v1/campaigns/{body['id']}", headers=citizen_headers).status_code
        == 403
    )

    override = api_client.post(
        "/api/v1/campaigns",
        headers=admin_headers,
        json=_payload(created_by=str(citizen.id)),
    )
    assert override.status_code == 422


def test_create_campaign_validation_dates_coordinates_and_text(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Create rejects inverted dates, half coordinate pairs, and blank text fields."""
    admin = _create_user(db_session, email="validation-admin@example.com", role=UserRole.ADMIN)
    headers = _auth_headers(admin)

    inverted = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(
            start_date="2027-01-12T09:00:00+00:00",
            end_date="2027-01-11T09:00:00+00:00",
        ),
    )
    assert inverted.status_code == 422

    latitude_only = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(longitude=None),
    )
    assert latitude_only.status_code == 422

    longitude_only = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(latitude=None),
    )
    assert longitude_only.status_code == 422

    both_coordinates = api_client.post("/api/v1/campaigns", headers=headers, json=_payload())
    assert both_coordinates.status_code == 201

    no_coordinates = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(latitude=None, longitude=None),
    )
    assert no_coordinates.status_code == 201
    assert no_coordinates.json()["latitude"] is None
    assert no_coordinates.json()["longitude"] is None

    blank_title = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(title="   "),
    )
    assert blank_title.status_code == 422

    blank_description = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(description="   "),
    )
    assert blank_description.status_code == 422

    blank_institution = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(institution=""),
    )
    assert blank_institution.status_code == 422

    naive_dates = api_client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=_payload(
            start_date="2027-02-01T09:00:00",
            end_date="2027-02-01T17:00:00",
        ),
    )
    assert naive_dates.status_code == 201


def test_patch_campaign_merged_validation_and_success(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """PATCH validates dates and coordinates against the stored row before applying changes."""
    admin = _create_user(db_session, email="patch-admin@example.com", role=UserRole.ADMIN)
    headers = _auth_headers(admin)
    campaign = _create_campaign(
        api_client,
        headers,
        start_date="2027-01-10T09:00:00+00:00",
        end_date="2027-01-12T17:00:00+00:00",
    )
    campaign_id = campaign["id"]

    invalid_range = api_client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json={"end_date": "2027-01-09T10:00:00+00:00"},
    )
    assert invalid_range.status_code == 422

    no_coords = _create_campaign(
        api_client,
        headers,
        title="Jornada sin coordenadas",
        latitude=None,
        longitude=None,
    )
    invalid_pair = api_client.patch(
        f"/api/v1/campaigns/{no_coords['id']}",
        headers=headers,
        json={"latitude": -19.05},
    )
    assert invalid_pair.status_code == 422

    single_coordinate = api_client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json={"latitude": -19.05},
    )
    assert single_coordinate.status_code == 200
    assert single_coordinate.json()["latitude"] == -19.05
    assert single_coordinate.json()["longitude"] == -65.2596

    single_date = api_client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json={"start_date": "2027-01-11T09:00:00+00:00"},
    )
    assert single_date.status_code == 200

    cleared = api_client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json={"latitude": None, "longitude": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["latitude"] is None
    assert cleared.json()["longitude"] is None

    renamed = api_client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json={"title": "Jornada actualizada"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Jornada actualizada"

    assert (
        api_client.patch(
            f"/api/v1/campaigns/{campaign_id}",
            headers=headers,
            json={"title": None},
        ).status_code
        == 422
    )
    assert (
        api_client.patch(f"/api/v1/campaigns/{campaign_id}", headers=headers, json={}).status_code
        == 422
    )
    assert (
        api_client.patch(
            "/api/v1/campaigns/999999",
            headers=headers,
            json={"title": "Inexistente"},
        ).status_code
        == 404
    )


def test_put_replace_and_delete_lifecycle(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """PUT replaces all content, DELETE removes the campaign, and later reads return 404."""
    admin = _create_user(db_session, email="lifecycle-admin@example.com", role=UserRole.ADMIN)
    headers = _auth_headers(admin)
    campaign = _create_campaign(api_client, headers)
    campaign_id = campaign["id"]

    replacement = _payload(
        title="Emergencia veterinaria",
        campaign_type="ATENCION_EMERGENCIA",
        description="Atención veterinaria de urgencia para animales atropellados.",
        requirements=None,
        location_address="Av. Jaime Mendoza 100, Sucre",
        latitude=None,
        longitude=None,
        start_date="2027-05-01T08:00:00+00:00",
        end_date="2027-05-02T20:00:00+00:00",
        institution="Municipio de Sucre",
    )
    replaced = api_client.put(
        f"/api/v1/campaigns/{campaign_id}",
        headers=headers,
        json=replacement,
    )
    assert replaced.status_code == 200, replaced.text
    replaced_body = replaced.json()
    assert replaced_body["title"] == "Emergencia veterinaria"
    assert replaced_body["campaign_type"] == "ATENCION_EMERGENCIA"
    assert replaced_body["requirements"] is None
    assert replaced_body["created_by"] == str(admin.id)

    assert (
        api_client.put("/api/v1/campaigns/999999", headers=headers, json=replacement).status_code
        == 404
    )

    deleted = api_client.delete(f"/api/v1/campaigns/{campaign_id}", headers=headers)
    assert deleted.status_code == 204
    assert api_client.get(f"/api/v1/campaigns/{campaign_id}").status_code == 404
    assert api_client.delete(f"/api/v1/campaigns/{campaign_id}", headers=headers).status_code == 404
