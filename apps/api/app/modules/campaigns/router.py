"""HTTP endpoints for public campaign listings and admin campaign management."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.database import SessionDep
from app.core.dependencies import require_role
from app.modules.auth.models import User, UserRole
from app.modules.campaigns import service
from app.modules.campaigns.models import CampaignType
from app.modules.campaigns.schemas import CampaignCreate, CampaignRead, CampaignUpdate

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])

AdminUser = Annotated[User, Depends(require_role([UserRole.ADMIN]))]


@router.get("", response_model=list[CampaignRead])
def list_campaigns(
    session: SessionDep,
    campaign_type: CampaignType | None = None,
    active_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[CampaignRead]:
    """List campaigns ordered by start date, optionally filtered by type or active window."""
    campaigns = service.list_campaigns(
        session=session,
        campaign_type=campaign_type,
        active_only=active_only,
        limit=limit,
        offset=offset,
    )
    return [CampaignRead.model_validate(campaign) for campaign in campaigns]


@router.get("/{campaign_id}", response_model=CampaignRead)
def read_campaign(
    campaign_id: int,
    session: SessionDep,
) -> CampaignRead:
    """Fetch a single campaign by id."""
    campaign = service.get_campaign_detail(session=session, campaign_id=campaign_id)
    return CampaignRead.model_validate(campaign)


@router.post("", response_model=CampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    admin_user: AdminUser,
    session: SessionDep,
) -> CampaignRead:
    """Create a campaign attributed to the authenticated administrator."""
    campaign = service.create_campaign(
        session=session,
        current_user=admin_user,
        payload=payload,
    )
    return CampaignRead.model_validate(campaign)


@router.patch("/{campaign_id}", response_model=CampaignRead)
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    _admin_user: AdminUser,
    session: SessionDep,
) -> CampaignRead:
    """Partially update an existing campaign."""
    campaign = service.update_campaign(
        session=session,
        campaign_id=campaign_id,
        payload=payload,
    )
    return CampaignRead.model_validate(campaign)


@router.put("/{campaign_id}", response_model=CampaignRead)
def replace_campaign(
    campaign_id: int,
    payload: CampaignCreate,
    _admin_user: AdminUser,
    session: SessionDep,
) -> CampaignRead:
    """Fully replace an existing campaign's content."""
    campaign = service.replace_campaign(
        session=session,
        campaign_id=campaign_id,
        payload=payload,
    )
    return CampaignRead.model_validate(campaign)


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    _admin_user: AdminUser,
    session: SessionDep,
) -> None:
    """Delete an existing campaign."""
    service.delete_campaign(session=session, campaign_id=campaign_id)
