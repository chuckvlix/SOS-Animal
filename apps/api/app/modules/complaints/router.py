"""HTTP endpoints for offense catalog, draft complaints, submission, PDFs, and tracking."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.database import SessionDep
from app.core.dependencies import CurrentUser, require_role
from app.core.storage import (
    S3ClientProtocol,
    S3DocumentClientProtocol,
    get_internal_s3_client,
    get_s3_client,
)
from app.modules.auth.models import User, UserRole
from app.modules.complaints import service
from app.modules.complaints.models import ComplaintStatus, OffenseMainType
from app.modules.complaints.schemas import (
    ComplaintCreateRequest,
    ComplaintDownloadUrlResponse,
    ComplaintEvidenceCreateRequest,
    ComplaintEvidenceRead,
    ComplaintPreviewResponse,
    ComplaintPublicTrackingRead,
    ComplaintRead,
    ComplaintStatusUpdateRequest,
    ComplaintUpdateRequest,
    OffenseCategoryRead,
)

router = APIRouter(prefix="/complaints", tags=["Complaints"])

ManagerUser = Annotated[User, Depends(require_role([UserRole.ADMIN, UserRole.GESTOR_CEMZOO]))]
PublicS3Client = Annotated[S3ClientProtocol, Depends(get_s3_client)]
InternalS3Client = Annotated[S3DocumentClientProtocol, Depends(get_internal_s3_client)]


@router.get("/categories", response_model=list[OffenseCategoryRead])
def list_categories(
    session: SessionDep,
    main_type: OffenseMainType | None = None,
) -> list[OffenseCategoryRead]:
    """Return the statutory Maltrato and Biocidio offense catalog."""
    categories = service.list_offense_categories(session=session, main_type=main_type)
    return [OffenseCategoryRead.model_validate(category) for category in categories]


@router.get("/track/{tracking_code}", response_model=ComplaintPublicTrackingRead)
def track_complaint_public(
    tracking_code: str,
    session: SessionDep,
) -> ComplaintPublicTrackingRead:
    """Return privacy-safe public status tracking for a submitted complaint."""
    return service.get_public_tracking(session=session, tracking_code=tracking_code)


@router.get("/me", response_model=list[ComplaintRead])
def list_my_complaints(
    current_user: CurrentUser,
    session: SessionDep,
) -> list[ComplaintRead]:
    """List drafts and submitted complaints owned by the authenticated citizen."""
    complaints = service.list_user_complaints(session=session, current_user=current_user)
    return [ComplaintRead.model_validate(complaint) for complaint in complaints]


@router.get("", response_model=list[ComplaintRead])
def list_institutional_complaints(
    _manager_user: ManagerUser,
    session: SessionDep,
    status_filter: Annotated[ComplaintStatus | None, Query(alias="status")] = None,
    main_type: OffenseMainType | None = None,
) -> list[ComplaintRead]:
    """List immutable submitted complaints for CEMZOO and administrator triage."""
    complaints = service.list_institutional_complaints(
        session=session,
        status_filter=status_filter,
        main_type=main_type,
    )
    return [ComplaintRead.model_validate(complaint) for complaint in complaints]


@router.post("", response_model=ComplaintRead, status_code=status.HTTP_201_CREATED)
def create_draft_complaint(
    payload: ComplaintCreateRequest,
    current_user: CurrentUser,
    session: SessionDep,
) -> ComplaintRead:
    """Create a mutable citizen complaint draft in BORRADOR status."""
    complaint = service.create_draft_complaint(
        session=session,
        current_user=current_user,
        payload=payload,
    )
    return ComplaintRead.model_validate(complaint)


@router.get("/{complaint_id}", response_model=ComplaintRead)
def read_complaint(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
) -> ComplaintRead:
    """Fetch a single complaint owned by the user or accessible to CEMZOO/Admin."""
    complaint = service.get_complaint_detail(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
    )
    return ComplaintRead.model_validate(complaint)


@router.patch("/{complaint_id}", response_model=ComplaintRead)
def update_draft_complaint(
    complaint_id: uuid.UUID,
    payload: ComplaintUpdateRequest,
    current_user: CurrentUser,
    session: SessionDep,
) -> ComplaintRead:
    """Update fields on a mutable BORRADOR complaint."""
    complaint = service.update_draft_complaint(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
        payload=payload,
    )
    return ComplaintRead.model_validate(complaint)


@router.delete("/{complaint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft_complaint(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
) -> None:
    """Delete a mutable BORRADOR complaint."""
    service.delete_draft_complaint(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
    )


@router.post(
    "/{complaint_id}/evidences",
    response_model=ComplaintEvidenceRead,
    status_code=status.HTTP_201_CREATED,
)
def add_evidence(
    complaint_id: uuid.UUID,
    payload: ComplaintEvidenceCreateRequest,
    current_user: CurrentUser,
    session: SessionDep,
) -> ComplaintEvidenceRead:
    """Attach an uploaded MinIO evidence object to a mutable BORRADOR complaint."""
    evidence = service.add_complaint_evidence(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
        payload=payload,
    )
    return ComplaintEvidenceRead.model_validate(evidence)


@router.delete("/{complaint_id}/evidences/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_evidence(
    complaint_id: uuid.UUID,
    evidence_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
) -> None:
    """Remove an evidence attachment from a mutable BORRADOR complaint."""
    service.delete_complaint_evidence(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
        evidence_id=evidence_id,
    )


@router.get("/{complaint_id}/preview", response_model=ComplaintPreviewResponse)
def preview_complaint_document(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
) -> ComplaintPreviewResponse:
    """Render Step 6 HTML preview of the Documento de Denuncia."""
    complaint, html_preview = service.get_complaint_preview(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
    )
    return ComplaintPreviewResponse(complaint_id=complaint.id, html_preview=html_preview)


@router.post("/{complaint_id}/submit", response_model=ComplaintRead)
def submit_complaint(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
    s3_client: InternalS3Client,
) -> ComplaintRead:
    """Confirm complaint submission, generate PDF in MinIO, and lock immutability."""
    complaint = service.submit_complaint(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
        s3_client=s3_client,
    )
    return ComplaintRead.model_validate(complaint)


@router.get("/{complaint_id}/pdf", response_model=ComplaintDownloadUrlResponse)
def download_complaint_pdf(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    session: SessionDep,
    s3_client: PublicS3Client,
) -> ComplaintDownloadUrlResponse:
    """Generate a presigned GET URL to download the submitted Documento de Denuncia PDF."""
    result = service.get_complaint_pdf_download_url(
        session=session,
        current_user=current_user,
        complaint_id=complaint_id,
        s3_client=s3_client,
    )
    return ComplaintDownloadUrlResponse(
        download_url=result.download_url,
        object_key=result.object_key,
        expires_in_seconds=result.expires_in_seconds,
    )


@router.patch("/{complaint_id}/status", response_model=ComplaintRead)
def change_complaint_status(
    complaint_id: uuid.UUID,
    payload: ComplaintStatusUpdateRequest,
    _manager_user: ManagerUser,
    session: SessionDep,
) -> ComplaintRead:
    """Transition a submitted complaint status inside CEMZOO/Admin workflow."""
    complaint = service.update_complaint_status(
        session=session,
        complaint_id=complaint_id,
        new_status=payload.status,
    )
    return ComplaintRead.model_validate(complaint)
