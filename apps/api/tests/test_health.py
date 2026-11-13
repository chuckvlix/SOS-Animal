from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.core.database import get_session
from app.main import app


def test_health_check() -> None:
    """Ensure API health endpoint responds with 200 OK and service metadata."""
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "SOS Animal API"
    assert payload["version"] == "0.1.0"


def test_readiness_check_success_and_failure() -> None:
    """Ensure readiness endpoint reports 200 when DB succeeds and 503 when DB fails."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    def override_ok_session() -> Generator[Session, None, None]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_ok_session
    try:
        client = TestClient(app)
        ok_resp = client.get("/api/v1/ready")
        assert ok_resp.status_code == 200
        assert ok_resp.json() == {"status": "ready", "database": "ok"}

        class BrokenSession:
            def execute(self, _statement: object) -> None:
                raise OperationalError("SELECT 1", {}, Exception("db down"))

        def override_broken_session() -> Generator[BrokenSession, None, None]:
            yield BrokenSession()

        app.dependency_overrides[get_session] = override_broken_session  # type: ignore[assignment]
        fail_resp = client.get("/api/v1/ready")
        assert fail_resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
