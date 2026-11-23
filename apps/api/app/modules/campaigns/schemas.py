"""Pydantic v2 request/response schemas for animal welfare campaigns."""

import math
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.auth.schemas import has_disallowed_control_chars
from app.modules.campaigns.models import CampaignType

MAX_DESCRIPTION_LENGTH = 5000
MAX_REQUIREMENTS_LENGTH = 2000


def _strip_if_str(value: object) -> object:
    """Trim surrounding whitespace before Pydantic checks length bounds."""
    if isinstance(value, str):
        return value.strip()
    return value


def _reject_bool_or_non_finite(value: object) -> object:
    """Reject boolean or non-finite coordinate inputs."""
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


def _normalize_aware_datetime(value: datetime) -> datetime:
    """Treat naive datetimes as UTC and convert aware values to UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class CampaignCreate(BaseModel):
    """Admin payload to publish a vaccination, sterilization, or care campaign."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    campaign_type: CampaignType
    description: str = Field(min_length=1, max_length=MAX_DESCRIPTION_LENGTH)
    requirements: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_REQUIREMENTS_LENGTH,
    )
    location_address: str = Field(min_length=1, max_length=255)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0, allow_inf_nan=False)
    start_date: datetime
    end_date: datetime
    institution: str = Field(min_length=1, max_length=150)

    @field_validator("title", "location_address", "institution", mode="before")
    @classmethod
    def strip_single_line_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before validating bounds."""
        return _strip_if_str(value)

    @field_validator("description", "requirements", mode="before")
    @classmethod
    def strip_multiline_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before validating bounds."""
        return _strip_if_str(value)

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinates(cls, value: object) -> object:
        """Reject boolean or non-finite coordinate inputs."""
        return _reject_bool_or_non_finite(value)

    @field_validator("start_date", "end_date")
    @classmethod
    def normalize_dates(cls, value: datetime) -> datetime:
        """Normalize campaign datetimes to timezone-aware UTC."""
        return _normalize_aware_datetime(value)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Sanitize the single-line campaign title."""
        return _clean_single_line_text(value, "title", 1, 200)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        """Sanitize the multiline campaign description."""
        return _clean_multiline_text(value, "description", 1, MAX_DESCRIPTION_LENGTH)

    @field_validator("requirements")
    @classmethod
    def validate_requirements(cls, value: str | None) -> str | None:
        """Sanitize optional multiline attendance requirements."""
        if value is None:
            return None
        return _clean_multiline_text(value, "requirements", 1, MAX_REQUIREMENTS_LENGTH)

    @field_validator("location_address")
    @classmethod
    def validate_location_address(cls, value: str) -> str:
        """Sanitize the single-line campaign location."""
        return _clean_single_line_text(value, "location_address", 1, 255)

    @field_validator("institution")
    @classmethod
    def validate_institution(cls, value: str) -> str:
        """Sanitize the single-line organizing institution name."""
        return _clean_single_line_text(value, "institution", 1, 150)

    @model_validator(mode="after")
    def validate_campaign_rules(self) -> Self:
        """Require a paired coordinate set and a non-inverted date range."""
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Both latitude and longitude must be provided together.")
        if self.end_date < self.start_date:
            raise ValueError("end_date must be greater than or equal to start_date.")
        return self


class CampaignUpdate(BaseModel):
    """Partial update payload for an existing campaign."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    campaign_type: CampaignType | None = None
    description: str | None = Field(default=None, min_length=1, max_length=MAX_DESCRIPTION_LENGTH)
    requirements: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_REQUIREMENTS_LENGTH,
    )
    location_address: str | None = Field(default=None, min_length=1, max_length=255)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0, allow_inf_nan=False)
    start_date: datetime | None = None
    end_date: datetime | None = None
    institution: str | None = Field(default=None, min_length=1, max_length=150)

    @field_validator("title", "location_address", "institution", mode="before")
    @classmethod
    def strip_single_line_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before validating bounds."""
        return _strip_if_str(value)

    @field_validator("description", "requirements", mode="before")
    @classmethod
    def strip_multiline_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before validating bounds."""
        return _strip_if_str(value)

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinates(cls, value: object) -> object:
        """Reject boolean or non-finite coordinate inputs."""
        return _reject_bool_or_non_finite(value)

    @field_validator("start_date", "end_date")
    @classmethod
    def normalize_dates(cls, value: datetime | None) -> datetime | None:
        """Normalize optional campaign datetimes to timezone-aware UTC."""
        if value is None:
            return None
        return _normalize_aware_datetime(value)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str | None) -> str | None:
        """Sanitize the optional single-line campaign title."""
        if value is None:
            return None
        return _clean_single_line_text(value, "title", 1, 200)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        """Sanitize the optional multiline campaign description."""
        if value is None:
            return None
        return _clean_multiline_text(value, "description", 1, MAX_DESCRIPTION_LENGTH)

    @field_validator("requirements")
    @classmethod
    def validate_requirements(cls, value: str | None) -> str | None:
        """Sanitize optional multiline attendance requirements."""
        if value is None:
            return None
        return _clean_multiline_text(value, "requirements", 1, MAX_REQUIREMENTS_LENGTH)

    @field_validator("location_address")
    @classmethod
    def validate_location_address(cls, value: str | None) -> str | None:
        """Sanitize the optional single-line campaign location."""
        if value is None:
            return None
        return _clean_single_line_text(value, "location_address", 1, 255)

    @field_validator("institution")
    @classmethod
    def validate_institution(cls, value: str | None) -> str | None:
        """Sanitize the optional single-line organizing institution name."""
        if value is None:
            return None
        return _clean_single_line_text(value, "institution", 1, 150)

    @model_validator(mode="after")
    def validate_patch_fields(self) -> Self:
        """Reject empty bodies, null overrides on required fields, and inverted date pairs."""
        if not self.model_fields_set:
            raise ValueError("At least one campaign field must be provided.")

        non_nullable = {
            "title",
            "campaign_type",
            "description",
            "location_address",
            "start_date",
            "end_date",
            "institution",
        }
        for field_name in self.model_fields_set & non_nullable:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be set to null.")

        if (
            {"start_date", "end_date"} <= self.model_fields_set
            and self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date must be greater than or equal to start_date.")
        return self


class CampaignRead(BaseModel):
    """Public campaign representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    campaign_type: CampaignType
    description: str
    requirements: str | None
    location_address: str
    latitude: float | None
    longitude: float | None
    start_date: datetime
    end_date: datetime
    institution: str
    created_by: uuid.UUID
