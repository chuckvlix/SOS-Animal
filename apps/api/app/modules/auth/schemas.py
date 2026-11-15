"""Pydantic v2 request/response schemas for authentication and progressive user profile."""

import contextlib
import re
import unicodedata
import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.modules.auth.models import UserRole

MAX_PASSWORD_LENGTH = 128
CI_PATTERN = re.compile(r"^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$")
PHONE_PATTERN = re.compile(r"^\+?[0-9]+(?:[ -][0-9]+)*$")
_DISALLOWED_UNICODE_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})


def _strip_if_str(value: object) -> object:
    """Trim leading/trailing whitespace before Pydantic checks string length bounds."""
    if isinstance(value, str):
        return value.strip()
    return value


def has_disallowed_control_chars(value: str, *, allow_format_chars: bool = False) -> bool:
    """Detect ASCII/C1 control, line/paragraph separator, and optional invisible format chars."""
    blocked = {"Cc", "Zl", "Zp"} if allow_format_chars else _DISALLOWED_UNICODE_CATEGORIES
    return any(unicodedata.category(ch) in blocked for ch in value)


def normalize_email_identifier(email: str) -> str:
    """Normalize email casing and convert punycode IDNA labels to lowercase Unicode."""
    cleaned = email.strip().lower()
    if "@" not in cleaned:
        return cleaned
    local_part, domain = cleaned.rsplit("@", 1)
    if "xn--" in domain:
        with contextlib.suppress(UnicodeError):
            domain = domain.encode("ascii").decode("idna").lower()
    return f"{local_part}@{domain}"


def _clean_safe_text(value: str, field_name: str, min_len: int, max_len: int) -> str:
    """Strip surrounding whitespace, reject control/invisible/HTML chars, and check bounds."""
    cleaned = value.strip()
    if has_disallowed_control_chars(cleaned):
        raise ValueError(f"{field_name} contains disallowed control or invisible characters.")
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
    password: str = Field(min_length=8, max_length=MAX_PASSWORD_LENGTH)

    @field_validator("full_name", "email", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before applying length and email checks."""
        return _strip_if_str(value)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        """Normalize and sanitize citizen display name."""
        return _clean_safe_text(value, "full_name", 2, 150)

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        """Normalize email to lowercase so uniqueness and login remain case-insensitive."""
        return normalize_email_identifier(str(value))

    @field_validator("password")
    @classmethod
    def validate_password_not_blank(cls, value: str) -> str:
        """Reject whitespace-only or control-character passwords while preserving valid spaces."""
        if has_disallowed_control_chars(value, allow_format_chars=True):
            raise ValueError("password must not contain control characters.")
        visible_chars = [
            ch for ch in value if not ch.isspace() and unicodedata.category(ch) != "Cf"
        ]
        if not visible_chars:
            raise ValueError(
                "password must not consist only of whitespace or invisible characters."
            )
        return value


class TokenResponse(BaseModel):
    """OAuth2 Bearer token response."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserProfileUpdate(BaseModel):
    """Progressive profiling payload for completing citizen identity fields."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    ci_number: str | None = Field(default=None, min_length=4, max_length=30)
    phone: str | None = Field(default=None, min_length=6, max_length=30)
    address: str | None = Field(default=None, min_length=5, max_length=255)

    @field_validator("full_name", "ci_number", "phone", "address", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value: object) -> object:
        """Trim surrounding whitespace before Pydantic enforces field length bounds."""
        return _strip_if_str(value)

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
        cleaned = _clean_safe_text(value, "ci_number", 4, 30)
        if not CI_PATTERN.fullmatch(cleaned) or sum(ch.isdigit() for ch in cleaned) < 4:
            raise ValueError("ci_number must be a valid identity document number.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        """Validate phone number digits, single spaces/hyphens, and optional leading plus."""
        if value is None:
            return None
        cleaned = _clean_safe_text(value, "phone", 6, 30)
        if not PHONE_PATTERN.fullmatch(cleaned) or sum(ch.isdigit() for ch in cleaned) < 6:
            raise ValueError("phone must contain at least 6 digits and valid separators.")
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
