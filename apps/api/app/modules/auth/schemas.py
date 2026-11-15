"""Pydantic v2 request/response schemas for authentication and progressive user profile."""

import re
import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.modules.auth.models import UserRole

CI_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-\s]{2,29}$")
PHONE_PATTERN = re.compile(r"^\+?[0-9][0-9\-\s]{5,29}$")


def _clean_safe_text(value: str, field_name: str, min_len: int, max_len: int) -> str:
    """Strip surrounding whitespace, reject HTML angle brackets/control chars, and check bounds."""
    cleaned = value.strip()
    if any(ord(ch) < 32 for ch in cleaned):
        raise ValueError(f"{field_name} must not contain control characters.")
    if len(cleaned) < min_len or len(cleaned) > max_len:
        raise ValueError(f"{field_name} must be between {min_len} and {max_len} characters.")
    if "<" in cleaned or ">" in cleaned:
        raise ValueError(f"{field_name} must not contain '<' or '>' characters.")
    return cleaned


class UserRegisterRequest(BaseModel):
    """Citizen registration payload."""

    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        """Normalize and sanitize citizen display name."""
        return _clean_safe_text(value, "full_name", 2, 150)

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        """Normalize email to lowercase so uniqueness and login remain case-insensitive."""
        return str(value).strip().lower()

    @field_validator("password")
    @classmethod
    def validate_password_not_blank(cls, value: str) -> str:
        """Reject whitespace-only passwords while preserving user-chosen spaces."""
        if value.isspace():
            raise ValueError("password must not consist only of whitespace.")
        return value


class TokenResponse(BaseModel):
    """OAuth2 Bearer token response."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserProfileUpdate(BaseModel):
    """Progressive profiling payload for completing citizen identity fields."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    ci_number: str | None = Field(default=None, min_length=3, max_length=30)
    phone: str | None = Field(default=None, min_length=6, max_length=30)
    address: str | None = Field(default=None, min_length=5, max_length=255)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str | None) -> str | None:
        """Validate optional updated full_name."""
        if value is None:
            return None
        return _clean_safe_text(value, "full_name", 2, 150)

    @field_validator("ci_number")
    @classmethod
    def validate_ci_number(cls, value: str | None) -> str | None:
        """Validate Bolivian identity card format without special HTML characters."""
        if value is None:
            return None
        cleaned = _clean_safe_text(value, "ci_number", 3, 30)
        if not CI_PATTERN.fullmatch(cleaned):
            raise ValueError("ci_number contains invalid characters.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        """Validate phone number digits, spaces, hyphens, and optional leading plus."""
        if value is None:
            return None
        cleaned = _clean_safe_text(value, "phone", 6, 30)
        if not PHONE_PATTERN.fullmatch(cleaned):
            raise ValueError("phone contains invalid characters.")
        return cleaned

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: str | None) -> str | None:
        """Validate real domicile address before complaint submission."""
        if value is None:
            return None
        return _clean_safe_text(value, "address", 5, 255)

    @model_validator(mode="after")
    def require_non_empty_non_null_patch(self) -> Self:
        """Reject empty PATCH bodies and explicit null overrides on profile fields."""
        if not self.model_fields_set:
            raise ValueError("At least one profile field must be provided.")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be set to null.")
        return self


class UserRoleUpdate(BaseModel):
    """Admin-only payload to update a user's RBAC role."""

    model_config = ConfigDict(extra="forbid")

    role: UserRole


class UserRead(BaseModel):
    """Public user representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: str
    role: UserRole
    ci_number: str | None
    phone: str | None
    address: str | None
    is_active: bool
    created_at: datetime
