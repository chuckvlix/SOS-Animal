"""Pydantic v2 request/response schemas for attention centers and geospatial directory."""

from pydantic import BaseModel, ConfigDict, Field

from app.modules.directory.models import CenterCategory


class AttentionCenterBase(BaseModel):
    """Base attributes shared across attention center schemas."""

    name: str = Field(
        min_length=2,
        max_length=150,
        description="Center commercial or official name",
    )
    category: CenterCategory = Field(
        description="Center classification: ZOONOSIS or VETERINARIA",
    )
    address: str = Field(
        min_length=3,
        max_length=255,
        description="Physical location in Sucre",
    )
    latitude: float = Field(ge=-90.0, le=90.0, description="WGS84 latitude")
    longitude: float = Field(ge=-180.0, le=180.0, description="WGS84 longitude")
    phone: str | None = Field(
        default=None,
        max_length=50,
        description="Emergency or contact telephone",
    )
    opening_hours: str = Field(
        min_length=2,
        max_length=150,
        description="Schedule description",
    )
    is_24_hours: bool = Field(
        default=False,
        description="Whether 24/7 emergency service is provided",
    )
    services: str = Field(
        min_length=3,
        description="Detailed list or description of services offered",
    )
    is_active: bool = Field(
        default=True,
        description="Whether the center is active and visible",
    )


class AttentionCenterCreate(AttentionCenterBase):
    """Schema for registering a new attention center."""

    pass


class AttentionCenterUpdate(BaseModel):
    """Schema for partially updating an attention center."""

    name: str | None = Field(default=None, min_length=2, max_length=150)
    category: CenterCategory | None = None
    address: str | None = Field(default=None, min_length=3, max_length=255)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    phone: str | None = Field(default=None, max_length=50)
    opening_hours: str | None = Field(default=None, min_length=2, max_length=150)
    is_24_hours: bool | None = None
    services: str | None = Field(default=None, min_length=3)
    is_active: bool | None = None


class AttentionCenterRead(AttentionCenterBase):
    """Response schema for attention center including optional calculated distance."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    distance_km: float | None = Field(
        default=None,
        description="Calculated great-circle distance from citizen location in kilometers",
    )
