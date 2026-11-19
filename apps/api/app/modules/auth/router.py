"""HTTP endpoints for registration, OAuth2 login, profile updates, and RBAC roles."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.security import OAuth2PasswordRequestForm

from app.core.database import SessionDep
from app.core.dependencies import CurrentUser, require_role
from app.modules.auth import service
from app.modules.auth.models import User, UserRole
from app.modules.auth.schemas import (
    TokenResponse,
    UserProfileUpdate,
    UserRead,
    UserRegisterRequest,
    UserRoleUpdate,
)

router = APIRouter(prefix="/auth", tags=["Auth"])

AdminUser = Annotated[User, Depends(require_role([UserRole.ADMIN]))]


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
def register(payload: UserRegisterRequest, session: SessionDep) -> User:
    """Register a new citizen account."""
    return service.register_user(session=session, payload=payload)


@router.post("/login", response_model=TokenResponse)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDep,
) -> TokenResponse:
    """Authenticate with email (OAuth2 username) and password to obtain a JWT token."""
    return service.authenticate_user(
        session=session,
        email=form_data.username,
        password=form_data.password,
    )


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: CurrentUser) -> User:
    """Return the authenticated user's profile."""
    return current_user


@router.patch("/me/profile", response_model=UserRead)
def update_my_profile(
    payload: UserProfileUpdate,
    current_user: CurrentUser,
    session: SessionDep,
) -> User:
    """Complete or update progressive profile fields required for formal complaints."""
    return service.update_user_profile(session=session, user=current_user, payload=payload)


@router.get("/users", response_model=list[UserRead])
def list_registered_users(
    _admin_user: AdminUser,
    session: SessionDep,
    role: UserRole | None = None,
    search: Annotated[str | None, Query(max_length=150)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[User]:
    """List registered accounts for superuser role management (administrator only)."""
    return service.list_users(
        session=session,
        role_filter=role,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.patch("/users/{user_id}/role", response_model=UserRead)
def change_user_role(
    user_id: uuid.UUID,
    payload: UserRoleUpdate,
    admin_user: AdminUser,
    session: SessionDep,
) -> User:
    """Assign an RBAC role to a user (administrator only)."""
    return service.update_user_role(
        session=session,
        actor=admin_user,
        target_user_id=user_id,
        new_role=payload.role,
    )
