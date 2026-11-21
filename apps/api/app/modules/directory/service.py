"""Business logic for Zoonosis and veterinary clinics CRUD and Haversine distance calculations."""

import math

import sqlalchemy as sa
from sqlmodel import Session, select

from app.modules.directory.models import AttentionCenter, CenterCategory
from app.modules.directory.schemas import (
    AttentionCenterCreate,
    AttentionCenterRead,
    AttentionCenterUpdate,
)

EARTH_RADIUS_KM = 6371.0


def calculate_haversine_distance(
    lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Calculate great-circle distance between two points in km via Haversine formula."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(EARTH_RADIUS_KM * c, 2)


def list_attention_centers(
    session: Session,
    *,
    category: CenterCategory | None = None,
    is_24_hours: bool | None = None,
    q: str | None = None,
    is_active: bool | None = True,
    user_lat: float | None = None,
    user_lng: float | None = None,
) -> list[AttentionCenterRead]:
    """Query attention centers applying filters and optional Haversine distance calculation."""
    query = select(AttentionCenter)

    if category is not None:
        query = query.where(AttentionCenter.category == category)

    if is_24_hours is not None:
        query = query.where(AttentionCenter.is_24_hours == is_24_hours)

    if is_active is not None:
        query = query.where(AttentionCenter.is_active == is_active)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.where(
            sa.or_(
                sa.func.lower(AttentionCenter.name).like(term),
                sa.func.lower(AttentionCenter.address).like(term),
                sa.func.lower(AttentionCenter.services).like(term),
            )
        )

    centers = session.exec(query).all()

    results: list[AttentionCenterRead] = []
    has_user_coords = user_lat is not None and user_lng is not None

    for center in centers:
        distance: float | None = None
        if has_user_coords:
            distance = calculate_haversine_distance(
                user_lat,  # type: ignore[arg-type]
                user_lng,  # type: ignore[arg-type]
                center.latitude,
                center.longitude,
            )

        center_data = AttentionCenterRead(
            id=center.id,  # type: ignore[arg-type]
            name=center.name,
            category=center.category,
            address=center.address,
            latitude=center.latitude,
            longitude=center.longitude,
            phone=center.phone,
            opening_hours=center.opening_hours,
            is_24_hours=center.is_24_hours,
            services=center.services,
            is_active=center.is_active,
            distance_km=distance,
        )
        results.append(center_data)

    if has_user_coords:
        results.sort(
            key=lambda item: (item.distance_km is None, item.distance_km, item.name.lower())
        )
    else:
        results.sort(key=lambda item: item.name.lower())

    return results


def get_center_by_id(session: Session, center_id: int) -> AttentionCenter | None:
    """Fetch an attention center by primary key."""
    return session.get(AttentionCenter, center_id)


def create_center(session: Session, data: AttentionCenterCreate) -> AttentionCenter:
    """Persist a new attention center entry."""
    center = AttentionCenter(
        name=data.name.strip(),
        category=data.category,
        address=data.address.strip(),
        latitude=data.latitude,
        longitude=data.longitude,
        phone=data.phone.strip() if data.phone else None,
        opening_hours=data.opening_hours.strip(),
        is_24_hours=data.is_24_hours,
        services=data.services.strip(),
        is_active=data.is_active,
    )
    session.add(center)
    session.commit()
    session.refresh(center)
    return center


def update_center(
    session: Session, center: AttentionCenter, data: AttentionCenterUpdate
) -> AttentionCenter:
    """Update attributes of an existing attention center."""
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(center, field, value)

    session.add(center)
    session.commit()
    session.refresh(center)
    return center


def delete_center(session: Session, center: AttentionCenter) -> None:
    """Permanently remove an attention center."""
    session.delete(center)
    session.commit()
