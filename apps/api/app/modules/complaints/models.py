import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlmodel import Field, Relationship, SQLModel

from app.core.database import str_enum_type, utc_now


class OffenseMainType(StrEnum):
    """Primary offense classification in Bolivian criminal law."""

    MALTRATO = "MALTRATO"
    BIOCIDIO = "BIOCIDIO"


class ComplaintStatus(StrEnum):
    """Lifecycle states of a citizen complaint."""

    BORRADOR = "BORRADOR"
    ENVIADA = "ENVIADA"
    EN_ATENCION_CEMZOO = "EN_ATENCION_CEMZOO"
    CERRADA = "CERRADA"


class EvidenceType(StrEnum):
    """Supported attachment categories for complaint evidence."""

    FOTO = "FOTO"
    VIDEO = "VIDEO"
    DOCUMENTO = "DOCUMENTO"


class OffenseCategory(SQLModel, table=True):
    """Catalog of animal cruelty and biocidio modalities with legal basis."""

    __tablename__ = "offense_categories"

    id: int | None = Field(default=None, primary_key=True)
    main_type: OffenseMainType = Field(
        sa_type=str_enum_type(OffenseMainType),
        index=True,
    )
    subtype_name: str = Field(unique=True, max_length=150)
    legal_basis: str = Field(sa_type=sa.Text)

    complaints: list["Complaint"] = Relationship(back_populates="offense_category")


class Complaint(SQLModel, table=True):
    """Citizen complaint entity supporting mutable draft and immutable submission."""

    __tablename__ = "complaints"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tracking_code: str | None = Field(default=None, unique=True, index=True, max_length=20)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    offense_category_id: int = Field(foreign_key="offense_categories.id", index=True)
    incident_date: datetime = Field(sa_type=sa.DateTime(timezone=True))
    incident_address: str = Field(max_length=255)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)
    description: str = Field(sa_type=sa.Text)
    status: ComplaintStatus = Field(
        default=ComplaintStatus.BORRADOR,
        sa_type=str_enum_type(ComplaintStatus),
        index=True,
    )
    is_immutable: bool = Field(default=False)
    pdf_url: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_type=sa.DateTime(timezone=True),
    )
    submitted_at: datetime | None = Field(
        default=None,
        sa_type=sa.DateTime(timezone=True),
    )

    offense_category: OffenseCategory | None = Relationship(back_populates="complaints")
    evidences: list["ComplaintEvidence"] = Relationship(back_populates="complaint")


class ComplaintEvidence(SQLModel, table=True):
    """Evidence metadata pointing to an immutable S3/MinIO object key."""

    __tablename__ = "complaint_evidences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    complaint_id: uuid.UUID = Field(foreign_key="complaints.id", index=True)
    evidence_type: EvidenceType = Field(
        sa_type=str_enum_type(EvidenceType),
    )
    object_key: str = Field(unique=True, max_length=500)
    mime_type: str = Field(max_length=100)
    file_size_bytes: int
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_type=sa.DateTime(timezone=True),
    )

    complaint: Complaint | None = Relationship(back_populates="evidences")
