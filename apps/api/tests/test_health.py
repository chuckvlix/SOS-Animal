from fastapi.testclient import TestClient

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
