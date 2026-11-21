"""FastAPI endpoints for Zoonosis and veterinary clinics directory."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import SessionDep
from app.core.dependencies import require_role
from app.modules.auth.models import User
from app.modules.directory import service
from app.modules.directory.models import CenterCategory
from app.modules.directory.schemas import (
    AttentionCenterCreate,
    AttentionCenterRead,
    AttentionCenterUpdate,
)

router = APIRouter(prefix="/directory", tags=["Directory"])


@router.get(
    "/",
    response_model=list[AttentionCenterRead],
    summary="List attention centers with filters and distance",
    description=(
        "Retrieve public directory of Zoonosis and veterinary clinics "
        "with optional Haversine distance from citizen coordinates."
    ),
)
def list_centers(
    session: SessionDep,
    category: Annotated[
        CenterCategory | None,
        Query(description="Filter by center category (ZOONOSIS or VETERINARIA)"),
    ] = None,
    is_24_hours: Annotated[
        bool | None,
        Query(description="Filter centers providing 24-hour emergency care"),
    ] = None,
    q: Annotated[
        str | None,
        Query(
            max_length=100,
            description="Case-insensitive text search across name, address, and services",
        ),
    ] = None,
    is_active: Annotated[
        bool | None,
        Query(
            description="Filter active or inactive centers (defaults to true for public display)"
        ),
    ] = True,
    user_lat: Annotated[
        float | None,
        Query(ge=-90.0, le=90.0, description="Citizen latitude for distance computation"),
    ] = None,
    user_lng: Annotated[
        float | None,
        Query(ge=-180.0, le=180.0, description="Citizen longitude for distance computation"),
    ] = None,
) -> list[AttentionCenterRead]:
    """List attention centers applying query filters and optional location proximity sorting."""
    if (user_lat is None) != (user_lng is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Both user_lat and user_lng must be provided together "
                "for distance calculations."
            ),
        )

    return service.list_attention_centers(
        session,
        category=category,
        is_24_hours=is_24_hours,
        q=q,
        is_active=is_active,
        user_lat=user_lat,
        user_lng=user_lng,
    )


@router.get(
    "/{center_id}",
    response_model=AttentionCenterRead,
    summary="Get single attention center",
    description="Retrieve full details for an individual Zoonosis or veterinary clinic by ID.",
)
def get_center(
    center_id: int,
    session: SessionDep,
) -> AttentionCenterRead:
    """Retrieve an attention center by its primary key."""
    center = service.get_center_by_id(session, center_id)
    if center is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attention center with ID {center_id} not found.",
        )
    return AttentionCenterRead.model_validate(center)


@router.post(
    "/",
    response_model=AttentionCenterRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create attention center (Admin only)",
    description=(
        "Register a new Zoonosis or veterinary clinic in the directory. "
        "Requires admin role."
    ),
)
def create_center(
    payload: AttentionCenterCreate,
    session: SessionDep,
    _current_user: Annotated[User, Depends(require_role(["admin"]))],
) -> AttentionCenterRead:
    """Create a new attention center entry."""
    center = service.create_center(session, payload)
    return AttentionCenterRead.model_validate(center)


@router.patch(
    "/{center_id}",
    response_model=AttentionCenterRead,
    summary="Update attention center (Admin only)",
    description="Partially update an existing attention center's information. Requires admin role.",
)
def update_center(
    center_id: int,
    payload: AttentionCenterUpdate,
    session: SessionDep,
    _current_user: Annotated[User, Depends(require_role(["admin"]))],
) -> AttentionCenterRead:
    """Update attributes of an existing attention center."""
    center = service.get_center_by_id(session, center_id)
    if center is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attention center with ID {center_id} not found.",
        )
    updated = service.update_center(session, center, payload)
    return AttentionCenterRead.model_validate(updated)


@router.delete(
    "/{center_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete attention center (Admin only)",
    description="Permanently remove an attention center from the directory. Requires admin role.",
)
def delete_center(
    center_id: int,
    session: SessionDep,
    _current_user: Annotated[User, Depends(require_role(["admin"]))],
) -> None:
    """Delete an attention center."""
    center = service.get_center_by_id(session, center_id)
    if center is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attention center with ID {center_id} not found.",
        )
    service.delete_center(session, center)
