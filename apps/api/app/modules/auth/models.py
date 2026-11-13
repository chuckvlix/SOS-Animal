import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.core.database import str_enum_type, utc_now


class UserRole(StrEnum):
    """Valid RBAC roles for SOS Animal."""

    CIUDADANO = "ciudadano"
    GESTOR_CEMZOO = "gestor_cemzoo"
    ADMIN = "admin"


class User(SQLModel, table=True):
    """Registered platform user with progressive legal profile fields."""

    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    full_name: str = Field(max_length=150)
    email: str = Field(unique=True, index=True, max_length=255)
    password_hash: str = Field(max_length=255)
    role: UserRole = Field(
        default=UserRole.CIUDADANO,
        sa_type=str_enum_type(UserRole),
    )
    ci_number: str | None = Field(default=None, max_length=30, index=True)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=255)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_type=sa.DateTime(timezone=True),
    )
