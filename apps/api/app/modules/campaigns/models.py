import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.core.database import str_enum_type


class CampaignType(StrEnum):
    """Public animal welfare and veterinary campaign categories."""

    CALENDARIO_VACUNACION = "CALENDARIO_VACUNACION"
    CAMPANA_ESTERILIZACION = "CAMPANA_ESTERILIZACION"
    ATENCION_EMERGENCIA = "ATENCION_EMERGENCIA"
    PROXIMA_JORNADA = "PROXIMA_JORNADA"


class Campaign(SQLModel, table=True):
    """Scheduled vaccination, sterilization, or emergency care campaign."""

    __tablename__ = "campaigns"

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(max_length=200)
    campaign_type: CampaignType = Field(
        sa_type=str_enum_type(CampaignType, length=48),
        index=True,
    )
    description: str = Field(sa_type=sa.Text)
    requirements: str | None = Field(default=None, sa_type=sa.Text)
    location_address: str = Field(max_length=255)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)
    start_date: datetime = Field(sa_type=sa.DateTime(timezone=True), index=True)
    end_date: datetime = Field(sa_type=sa.DateTime(timezone=True))
    institution: str = Field(max_length=150)
    created_by: uuid.UUID = Field(foreign_key="users.id", index=True)
