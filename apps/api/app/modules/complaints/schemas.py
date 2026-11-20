"""Pydantic v2 request/response schemas for complaints, offense catalog, and tracking."""

import math
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.core.database import utc_now
from app.modules.auth.schemas import has_disallowed_control_chars
from app.modules.complaints.models import ComplaintStatus, EvidenceType, OffenseMainType

EVIDENCE_OBJECT_KEY_PATTERN = re.compile(
    r"^evidences/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"\.(jpg|png|webp)$"
)
TRACKING_CODE_PATTERN = re.compile(r"^SOS-[0-9]{6}-[0-9]{4}$")


def _strip_if_str(value: object) -> object:
    if isinstance(value, str):
        return value.strip()
    return value


def _reject_bool_or_non_finite(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("Coordinate must be a valid number, not a boolean.")
    if isinstance(value, (int, float)) and not math.isfinite(float(value)):
        raise ValueError("Coordinate must be a finite number.")
    return value


def _clean_single_line_text(value: str, field_name: str, min_len: int, max_len: int) -> str:
    cleaned = value.strip()
    if has_disallowed_control_chars(cleaned):
        raise ValueError(f"{field_name} contains disallowed control or invisible characters.")
    if len(cleaned) < min_len or len(cleaned) > max_len:
        raise ValueError(f"{field_name} must be between {min_len} and {max_len} characters.")
    if len(" ".join(cleaned.split())) < min_len:
        raise ValueError(f"{field_name} must contain at least {min_len} meaningful characters.")
    if "<" in cleaned or ">" in cleaned:
        raise ValueError(f"{field_name} must not contain '<' or '>' characters.")
    return cleaned


def _clean_multiline_text(value: str, field_name: str, min_len: int, max_len: int) -> str:
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    for ch in normalized:
        if ch in {"\n", "\t"}:
            continue
        if unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"}:
            raise ValueError(f"{field_name} contains disallowed control or invisible characters.")
    if len(normalized) < min_len or len(normalized) > max_len:
        raise ValueError(f"{field_name} must be between {min_len} and {max_len} characters.")
    if len(" ".join(normalized.split())) < min_len:
        raise ValueError(f"{field_name} must contain at least {min_len} meaningful characters.")
    if "<" in normalized or ">" in normalized:
        raise ValueError(f"{field_name} must not contain '<' or '>' characters.")
    return normalized


def _normalize_incident_date(value: datetime) -> datetime:
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    if normalized > utc_now():
        raise ValueError("incident_date cannot be in the future.")
    return normalized


class OffenseCategoryRead(BaseModel):
    """Public offense category output with statutory legal basis."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    main_type: OffenseMainType
    subtype_name: str
    legal_basis: str


class ComplaintCreateRequest(BaseModel):
    """Payload to create a mutable citizen complaint draft (BORRADOR)."""

    model_config = ConfigDict(extra="forbid")

    offense_category_id: StrictInt = Field(gt=0)
    incident_date: datetime
    incident_address: str = Field(min_length=5, max_length=255)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0, allow_inf_nan=False)
    description: str = Field(min_length=10, max_length=5000)

    @field_validator("incident_address", "description", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        """Trim surrounding spaces before Pydantic checks length bounds."""
        return _strip_if_str(value)

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinates(cls, value: object) -> object:
        """Reject boolean or non-finite coordinate inputs."""
        return _reject_bool_or_non_finite(value)

    @field_validator("incident_date")
    @classmethod
    def validate_incident_date(cls, value: datetime) -> datetime:
        """Ensure incident_date is UTC-normalized and not in the future."""
        return _normalize_incident_date(value)

    @field_validator("incident_address")
    @classmethod
    def validate_incident_address(cls, value: str) -> str:
        """Sanitize single-line incident address."""
        return _clean_single_line_text(value, "incident_address", 5, 255)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        """Sanitize multiline complaint narrative."""
        return _clean_multiline_text(value, "description", 10, 5000)

    @model_validator(mode="after")
    def validate_coordinate_pair(self) -> Self:
        """Require latitude and longitude to be supplied or omitted together."""
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Both latitude and longitude must be provided together.")
        return self


class ComplaintUpdateRequest(BaseModel):
    """Partial update payload for a mutable BORRADOR complaint."""

    model_config = ConfigDict(extra="forbid")

    offense_category_id: StrictInt | None = Field(default=None, gt=0)
    incident_date: datetime | None = None
    incident_address: str | None = Field(default=None, min_length=5, max_length=255)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0, allow_inf_nan=False)
    description: str | None = Field(default=None, min_length=10, max_length=5000)

    @field_validator("incident_address", "description", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        """Trim surrounding spaces before Pydantic checks length bounds."""
        return _strip_if_str(value)

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinates(cls, value: object) -> object:
        """Reject boolean or non-finite coordinate inputs."""
        return _reject_bool_or_non_finite(value)

    @field_validator("incident_date")
    @classmethod
    def validate_incident_date(cls, value: datetime | None) -> datetime | None:
        """Ensure optional incident_date is UTC-normalized and not in the future."""
        if value is None:
            return None
        return _normalize_incident_date(value)

    @field_validator("incident_address")
    @classmethod
    def validate_incident_address(cls, value: str | None) -> str | None:
        """Sanitize optional incident_address."""
        if value is None:
            return None
        return _clean_single_line_text(value, "incident_address", 5, 255)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        """Sanitize optional multiline complaint narrative."""
        if value is None:
            return None
        return _clean_multiline_text(value, "description", 10, 5000)

    @model_validator(mode="after")
    def validate_patch_fields(self) -> Self:
        """Reject empty PATCH bodies, non-nullable null overrides, and half-set coordinates."""
        if not self.model_fields_set:
            raise ValueError("At least one complaint field must be provided.")

        non_nullable = {"offense_category_id", "incident_date", "incident_address", "description"}
        for field_name in self.model_fields_set & non_nullable:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be set to null.")

        coord_fields = {"latitude", "longitude"} & self.model_fields_set
        if coord_fields and (
            coord_fields != {"latitude", "longitude"}
            or (self.latitude is None) != (self.longitude is None)
        ):
            raise ValueError("Both latitude and longitude must be updated or cleared together.")
        return self


class ComplaintEvidenceCreateRequest(BaseModel):
    """Metadata payload linking an uploaded MinIO photo to a draft complaint."""

    model_config = ConfigDict(extra="forbid")

    evidence_type: EvidenceType = EvidenceType.FOTO
    object_key: str = Field(min_length=20, max_length=500)
    mime_type: str = Field(min_length=3, max_length=100)
    file_size_bytes: StrictInt = Field(gt=0)

    @field_validator("object_key", "mime_type", mode="before")
    @classmethod
    def normalize_strings(cls, value: object) -> object:
        """Trim surrounding whitespace before validating pattern and bounds."""
        return _strip_if_str(value)

    @field_validator("object_key")
    @classmethod
    def validate_object_key(cls, value: str) -> str:
        """Restrict object_key strictly to evidences/<uuid4>.<ext> keys."""
        if not EVIDENCE_OBJECT_KEY_PATTERN.fullmatch(value):
            raise ValueError(
                "object_key must match 'evidences/<uuid4>.<ext>' for an allowed evidence file."
            )
        return value

    @field_validator("mime_type")
    @classmethod
    def normalize_mime(cls, value: str) -> str:
        """Normalize MIME casing."""
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("mime_type must not be blank.")
        return cleaned


class ComplaintEvidenceRead(BaseModel):
    """Evidence attachment metadata returned inside complaint payloads."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    complaint_id: uuid.UUID
    evidence_type: EvidenceType
    object_key: str
    mime_type: str
    file_size_bytes: int
    created_at: datetime


class ComplaintRead(BaseModel):
    """Detailed complaint view for owner or institutional managers."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tracking_code: str | None
    user_id: uuid.UUID
    offense_category_id: int
    incident_date: datetime
    incident_address: str
    latitude: float | None
    longitude: float | None
    description: str
    status: ComplaintStatus
    is_immutable: bool
    pdf_url: str | None
    created_at: datetime
    submitted_at: datetime | None
    offense_category: OffenseCategoryRead | None = None
    evidences: list[ComplaintEvidenceRead] = Field(default_factory=list)


class ComplaintPreviewResponse(BaseModel):
    """Step 6 preview payload for the Documento de Denuncia."""

    complaint_id: uuid.UUID
    title: Literal["DOCUMENTO DE DENUNCIA"] = "DOCUMENTO DE DENUNCIA"
    html_preview: str


class ComplaintDownloadUrlResponse(BaseModel):
    """Presigned download URL response for a submitted Documento de Denuncia PDF."""

    download_url: str
    object_key: str
    expires_in_seconds: int


class ComplaintCategoryStat(BaseModel):
    """Submitted complaint count grouped by offense category."""

    category_id: int
    main_type: OffenseMainType
    subtype_name: str
    count: int


class ComplaintStatsRead(BaseModel):
    """Historical and statistical summary for the University admin panel."""

    total_submitted: int
    total_maltrato: int
    total_biocidio: int
    total_with_coordinates: int
    total_photos: int
    by_category: list[ComplaintCategoryStat]
