from datetime import UTC, datetime, timedelta

import jwt
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.modules.auth.models import UserRole

password_hasher = PasswordHash.recommended()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


class TokenPayload(BaseModel):
    """Validated JWT claims payload."""

    sub: str = Field(min_length=1)
    role: UserRole
    exp: int

    @field_validator("exp", mode="before")
    @classmethod
    def reject_bool_exp(cls, value: object) -> object:
        """Reject boolean values that Python treats as int subclasses."""
        if isinstance(value, bool):
            raise ValueError("Token expiration must not be a boolean")
        return value


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against an Argon2 hash."""
    if not hashed_password:
        return False
    try:
        return password_hasher.verify(plain_password, hashed_password)
    except (PwdlibError, ValueError, TypeError):
        return False


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2."""
    if not password:
        raise ValueError("Password must not be empty")
    return password_hasher.hash(password)


def create_access_token(
    subject: str,
    role: UserRole | str,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT access token containing user ID and role."""
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": subject,
        "role": UserRole(role).value,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> TokenPayload:
    """Decode and validate a JWT access token."""
    try:
        raw_payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return TokenPayload.model_validate(raw_payload)
    except (InvalidTokenError, ValueError) as exc:
        raise ValueError("Invalid or expired authentication token") from exc
