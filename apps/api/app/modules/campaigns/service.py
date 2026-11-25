"""Business logic for vaccination, sterilization, and emergency care campaigns."""

from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.database import utc_now
from app.modules.auth.models import User
from app.modules.campaigns.models import Campaign, CampaignType
from app.modules.campaigns.schemas import CampaignCreate, CampaignUpdate


def _ensure_aware(value: datetime) -> datetime:
    """Treat naive stored datetimes as UTC so comparisons never raise."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _ensure_valid_date_range(start_date: datetime, end_date: datetime) -> None:
    """Reject campaigns whose end date precedes their start date."""
    if _ensure_aware(end_date) < _ensure_aware(start_date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_date must be greater than or equal to start_date.",
        )


def _ensure_valid_coordinate_pair(latitude: float | None, longitude: float | None) -> None:
    """Require latitude and longitude to be present or absent together."""
    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Both latitude and longitude must be provided together.",
        )


def _get_campaign_or_404(session: Session, campaign_id: int) -> Campaign:
    campaign = session.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found.",
        )
    return campaign


def list_campaigns(
    *,
    session: Session,
    campaign_type: CampaignType | None = None,
    active_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Campaign]:
    """List campaigns ordered by start date, optionally filtered by type or active window."""
    stmt = select(Campaign)
    if campaign_type is not None:
        stmt = stmt.where(Campaign.campaign_type == campaign_type)
    if active_only:
        stmt = stmt.where(Campaign.end_date >= utc_now())
    stmt = (
        stmt.order_by(sa.asc(Campaign.start_date), sa.asc(Campaign.id))  # type: ignore[arg-type]
        .offset(offset)
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_campaign_detail(*, session: Session, campaign_id: int) -> Campaign:
    """Return a single campaign or raise HTTP 404."""
    return _get_campaign_or_404(session, campaign_id)


def create_campaign(
    *,
    session: Session,
    current_user: User,
    payload: CampaignCreate,
) -> Campaign:
    """Create a campaign attributed to the authenticated administrator."""
    _ensure_valid_coordinate_pair(payload.latitude, payload.longitude)
    _ensure_valid_date_range(payload.start_date, payload.end_date)
    campaign = Campaign(**payload.model_dump(), created_by=current_user.id)
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return campaign


def update_campaign(
    *,
    session: Session,
    campaign_id: int,
    payload: CampaignUpdate,
) -> Campaign:
    """Apply a partial update after validating the merged date range and coordinate pair."""
    campaign = _get_campaign_or_404(session, campaign_id)
    updates = payload.model_dump(exclude_unset=True)

    merged_start = updates.get("start_date", campaign.start_date)
    merged_end = updates.get("end_date", campaign.end_date)
    _ensure_valid_date_range(merged_start, merged_end)

    merged_latitude = updates.get("latitude", campaign.latitude)
    merged_longitude = updates.get("longitude", campaign.longitude)
    _ensure_valid_coordinate_pair(merged_latitude, merged_longitude)

    for field_name, value in updates.items():
        setattr(campaign, field_name, value)
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return campaign


def replace_campaign(
    *,
    session: Session,
    campaign_id: int,
    payload: CampaignCreate,
) -> Campaign:
    """Fully replace campaign content while preserving its original author."""
    campaign = _get_campaign_or_404(session, campaign_id)
    _ensure_valid_coordinate_pair(payload.latitude, payload.longitude)
    _ensure_valid_date_range(payload.start_date, payload.end_date)
    for field_name, value in payload.model_dump().items():
        setattr(campaign, field_name, value)
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return campaign


def delete_campaign(*, session: Session, campaign_id: int) -> None:
    """Delete an existing campaign or raise HTTP 404."""
    campaign = _get_campaign_or_404(session, campaign_id)
    session.delete(campaign)
    session.commit()
