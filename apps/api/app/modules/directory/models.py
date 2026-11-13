from enum import StrEnum

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.core.database import str_enum_type


class CenterCategory(StrEnum):
    """Classification for animal attention facilities."""

    ZOONOSIS = "ZOONOSIS"
    VETERINARIA = "VETERINARIA"


class AttentionCenter(SQLModel, table=True):
    """Geolocated Zoonosis and veterinary clinic directory entry."""

    __tablename__ = "attention_centers"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=150, index=True)
    category: CenterCategory = Field(
        sa_type=str_enum_type(CenterCategory),
        index=True,
    )
    address: str = Field(max_length=255)
    latitude: float
    longitude: float
    phone: str | None = Field(default=None, max_length=50)
    opening_hours: str = Field(max_length=150)
    is_24_hours: bool = Field(default=False, index=True)
    services: str = Field(sa_type=sa.Text)
    is_active: bool = Field(default=True, index=True)
