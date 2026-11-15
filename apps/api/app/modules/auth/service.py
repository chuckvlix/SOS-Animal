"""Business logic for registration, OAuth2/JWT login, and user profile updates."""

import uuid

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.auth.models import User, UserRole
from app.modules.auth.schemas import (
    MAX_PASSWORD_LENGTH,
    TokenResponse,
    UserProfileUpdate,
    UserRegisterRequest,
    has_disallowed_control_chars,
    normalize_email_identifier,
)

# Precomputed dummy hash keeps Argon2 verification timing uniform when an email is not found.
_DUMMY_PASSWORD_HASH: str = hash_password("sos-animal-constant-time-guard-2026")


def register_user(*, session: Session, payload: UserRegisterRequest) -> User:
    """Register a new citizen account, enforcing case-insensitive email uniqueness."""
    existing = session.exec(select(User).where(User.email == payload.email)).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.CIUDADANO,
        is_active=True,
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from exc

    session.refresh(user)
    return user


def authenticate_user(*, session: Session, email: str, password: str) -> TokenResponse:
    """Authenticate user credentials with Argon2 and return a signed Bearer JWT."""
    normalized_email = normalize_email_identifier(email)
    email_safe = (
        bool(normalized_email)
        and len(normalized_email) <= 255
        and not has_disallowed_control_chars(normalized_email)
    )
    user = (
        session.exec(select(User).where(User.email == normalized_email)).first()
        if email_safe
        else None
    )

    password_usable = len(password) <= MAX_PASSWORD_LENGTH and not has_disallowed_control_chars(
        password, allow_format_chars=True
    )
    candidate_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    candidate_password = password if password_usable else "invalid-password-guard"
    password_valid = verify_password(candidate_password, candidate_hash)

    if user is None or not user.is_active or not password_usable or not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(access_token=access_token, token_type="bearer")


def update_user_profile(
    *,
    session: Session,
    user: User,
    payload: UserProfileUpdate,
) -> User:
    """Apply progressive profile field updates for an authenticated user."""
    for field_name in payload.model_fields_set:
        setattr(user, field_name, getattr(payload, field_name))

    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update_user_role(
    *,
    session: Session,
    actor: User,
    target_user_id: uuid.UUID,
    new_role: UserRole,
) -> User:
    """Update a target user's RBAC role while preventing administrator lockouts."""
    target_user = session.get(User, target_user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if actor.id == target_user.id and new_role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot revoke their own admin role.",
        )

    if target_user.role == UserRole.ADMIN and new_role != UserRole.ADMIN:
        other_active_admin = session.exec(
            select(User.id).where(
                User.role == UserRole.ADMIN,
                User.is_active == sa.true(),
                User.id != target_user.id,
            )
        ).first()
        if other_active_admin is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active administrator must remain in the system.",
            )

    target_user.role = new_role
    session.add(target_user)
    session.commit()
    session.refresh(target_user)
    return target_user
