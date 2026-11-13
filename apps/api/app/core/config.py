from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "SOS Animal API"
    APP_VERSION: str = "0.1.0"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    DATABASE_URL: str = (
        "postgresql+psycopg://sos_animal:sos_animal_dev_password@localhost:5432/sos_animal_db"
    )

    SECRET_KEY: str = "change-this-super-secret-jwt-key-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    MINIO_ENDPOINT: str = "http://localhost:9000"
    MINIO_PUBLIC_ENDPOINT: str = "http://localhost:9000"
    MINIO_ROOT_USER: str = "minioadmin"
    MINIO_ROOT_PASSWORD: str = "minioadmin_dev_password"
    MINIO_BUCKET_EVIDENCES: str = "sos-evidences"
    MINIO_BUCKET_DOCUMENTS: str = "sos-documents"
    MINIO_USE_SSL: bool = False
    MAX_UPLOAD_SIZE_BYTES: int = 25 * 1024 * 1024

    CORS_ORIGINS: list[str] = ["http://localhost:4321"]


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()


settings: Settings = get_settings()
