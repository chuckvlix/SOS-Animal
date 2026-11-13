import uuid
from collections.abc import Callable, Sequence
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.database import SessionDep
from app.core.security import decode_access_token, oauth2_scheme
from app.modules.auth.models import User, UserRole


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: SessionDep,
) -> User:
    """Resolve and validate the authenticated user from a Bearer JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload.sub)
    except ValueError as exc:
        raise credentials_exception from exc

    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(allowed_roles: Sequence[UserRole | str]) -> Callable[[CurrentUser], User]:
    """Build a FastAPI dependency enforcing RBAC membership on endpoints."""
    allowed_set = frozenset(UserRole(role) for role in allowed_roles)
    if not allowed_set:
        raise ValueError("require_role requires at least one allowed role")

    def _role_checker(current_user: CurrentUser) -> User:
        if current_user.role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role permissions",
            )
        return current_user

    return _role_checker
