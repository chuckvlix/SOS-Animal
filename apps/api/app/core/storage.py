from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Literal, Protocol
from uuid import uuid4

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.core.config import Settings, get_settings
from app.core.dependencies import CurrentUser
from app.modules.auth.models import User, UserRole

PRESIGNED_UPLOAD_EXPIRY_SECONDS: int = 180

MIME_TO_EXTENSION: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
}

ALLOWED_EVIDENCE_MIME_TYPES: frozenset[str] = frozenset(MIME_TO_EXTENSION.keys())


class UploadValidationError(ValueError):
    """Raised when upload metadata violates MIME type, prefix, or size constraints."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class PresignedUploadResult:
    """Result payload returned after generating a presigned PUT upload URL."""

    upload_url: str
    object_key: str
    expires_in_seconds: int


class S3ClientProtocol(Protocol):
    """Structural protocol for S3-compatible presigned URL clients."""

    def generate_presigned_url(
        self,
        ClientMethod: str,
        Params: dict[str, object],
        ExpiresIn: int,
    ) -> str: ...


def validate_upload_metadata(
    mime_type: str,
    file_size_bytes: int,
    max_size_bytes: int | None = None,
) -> None:
    """Validate MIME whitelist and byte size limit before generating a presigned URL."""
    resolved_max_bytes = (
        get_settings().MAX_UPLOAD_SIZE_BYTES if max_size_bytes is None else max_size_bytes
    )
    normalized_mime = mime_type.strip().lower()
    if normalized_mime not in ALLOWED_EVIDENCE_MIME_TYPES:
        allowed = ", ".join(sorted(ALLOWED_EVIDENCE_MIME_TYPES))
        raise UploadValidationError(
            f"Unsupported MIME type '{mime_type}'. Allowed: {allowed}",
            status_code=415,
        )
    if isinstance(file_size_bytes, bool) or file_size_bytes <= 0:
        raise UploadValidationError(
            "File size must be greater than 0 bytes.",
            status_code=400,
        )
    if file_size_bytes > resolved_max_bytes:
        raise UploadValidationError(
            f"File size exceeds maximum allowed limit of {resolved_max_bytes} bytes.",
            status_code=413,
        )


def _sanitize_object_prefix(prefix: str) -> str:
    """Validate and normalize an S3 object key prefix without path traversal."""
    clean_prefix = prefix.strip().strip("/")
    if not clean_prefix or "\\" in clean_prefix:
        raise UploadValidationError("Upload prefix must be a non-empty relative path.", 400)
    segments = clean_prefix.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise UploadValidationError("Upload prefix contains invalid path segments.", 400)
    return "/".join(segments)


def build_object_key(prefix: str, mime_type: str) -> str:
    """Generate a collision-free S3 object key using uuid4 and MIME-mapped extension."""
    clean_prefix = _sanitize_object_prefix(prefix)
    normalized_mime = mime_type.strip().lower()
    if normalized_mime not in MIME_TO_EXTENSION:
        allowed = ", ".join(sorted(ALLOWED_EVIDENCE_MIME_TYPES))
        raise UploadValidationError(
            f"Unsupported MIME type '{mime_type}'. Allowed: {allowed}",
            status_code=415,
        )
    extension = MIME_TO_EXTENSION[normalized_mime]
    return f"{clean_prefix}/{uuid4()}{extension}"


@lru_cache(maxsize=8)
def _cached_s3_client(
    endpoint_url: str,
    access_key: str,
    secret_key: str,
    use_ssl: bool,
) -> BaseClient:
    """Reuse configured SigV4 boto3 S3 clients across requests for identical settings."""
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
        use_ssl=use_ssl,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def create_s3_client(endpoint_url: str) -> BaseClient:
    """Create or reuse a boto3 S3 client configured with SigV4 for MinIO compatibility."""
    current_settings = get_settings()
    clean_endpoint = endpoint_url.strip()
    lowered = clean_endpoint.lower()
    use_ssl = lowered.startswith("https://") or (
        not lowered.startswith("http://") and current_settings.MINIO_USE_SSL
    )
    return _cached_s3_client(
        clean_endpoint,
        current_settings.MINIO_ROOT_USER,
        current_settings.MINIO_ROOT_PASSWORD,
        use_ssl,
    )


def generate_presigned_upload(
    *,
    mime_type: str,
    file_size_bytes: int,
    bucket: str | None = None,
    prefix: str = "evidences",
    client: S3ClientProtocol | None = None,
) -> PresignedUploadResult:
    """Validate file metadata and generate a 180-second presigned PUT URL."""
    current_settings = get_settings()
    target_bucket = current_settings.MINIO_BUCKET_EVIDENCES if bucket is None else bucket.strip()
    if not target_bucket:
        raise UploadValidationError("Target storage bucket must not be empty.", status_code=400)
    validate_upload_metadata(mime_type=mime_type, file_size_bytes=file_size_bytes)
    normalized_mime = mime_type.strip().lower()
    object_key = build_object_key(prefix=prefix, mime_type=normalized_mime)

    # Sign against the browser-reachable endpoint so the Host header matches on PUT.
    s3_client: S3ClientProtocol = client or create_s3_client(current_settings.MINIO_PUBLIC_ENDPOINT)
    upload_url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": target_bucket,
            "Key": object_key,
            "ContentType": normalized_mime,
            "ContentLength": file_size_bytes,
        },
        ExpiresIn=PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    )
    return PresignedUploadResult(
        upload_url=upload_url,
        object_key=object_key,
        expires_in_seconds=PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    )


PresignedUploadPurpose = Literal["evidence", "norm"]


class PresignedUploadRequest(BaseModel):
    """Metadata validated before issuing a time-limited S3/MinIO PUT URL."""

    model_config = ConfigDict(extra="forbid")

    mime_type: str = Field(min_length=3, max_length=100)
    file_size_bytes: StrictInt = Field(gt=0)
    purpose: PresignedUploadPurpose = "evidence"

    @field_validator("mime_type", mode="before")
    @classmethod
    def normalize_mime_type(cls, value: object) -> object:
        """Trim surrounding spaces and normalize MIME type casing before length checks."""
        if isinstance(value, str):
            return value.strip().lower()
        return value


class PresignedUploadResponse(BaseModel):
    """Presigned PUT URL details returned to authorized uploaders."""

    upload_url: str
    object_key: str
    expires_in_seconds: int


def get_s3_client() -> S3ClientProtocol:
    """FastAPI dependency providing an S3 client bound to the public MinIO endpoint."""
    return create_s3_client(get_settings().MINIO_PUBLIC_ENDPOINT)


def _resolve_upload_target(
    *,
    purpose: PresignedUploadPurpose,
    current_user: User,
    normalized_mime: str,
    current_settings: Settings,
) -> tuple[str, str]:
    """Enforce bucket-level RBAC and return the target (bucket, prefix) tuple."""
    if purpose == "norm":
        if current_user.role not in {UserRole.ADMIN, UserRole.GESTOR_CEMZOO}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions to upload norm documents.",
            )
        if normalized_mime != "application/pdf":
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Norm documents must use application/pdf MIME type.",
            )
        target_bucket = current_settings.MINIO_BUCKET_DOCUMENTS.strip()
        if not target_bucket:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Document storage bucket is not configured.",
            )
        return target_bucket, "norms"

    target_bucket = current_settings.MINIO_BUCKET_EVIDENCES.strip()
    if not target_bucket:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Evidence storage bucket is not configured.",
        )
    return target_bucket, "evidences"


router = APIRouter(prefix="/storage", tags=["Storage"])


@router.post("/presigned-upload", response_model=PresignedUploadResponse)
def request_presigned_upload(
    payload: PresignedUploadRequest,
    current_user: CurrentUser,
    s3_client: Annotated[S3ClientProtocol, Depends(get_s3_client)],
) -> PresignedUploadResponse:
    """Validate upload metadata and return a 180-second presigned MinIO PUT URL.

    The caller must execute the HTTP PUT using the exact byte size and lowercase
    Content-Type header signed in the returned URL.
    """
    current_settings = get_settings()
    target_bucket, target_prefix = _resolve_upload_target(
        purpose=payload.purpose,
        current_user=current_user,
        normalized_mime=payload.mime_type,
        current_settings=current_settings,
    )

    try:
        result = generate_presigned_upload(
            mime_type=payload.mime_type,
            file_size_bytes=payload.file_size_bytes,
            bucket=target_bucket,
            prefix=target_prefix,
            client=s3_client,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return PresignedUploadResponse(
        upload_url=result.upload_url,
        object_key=result.object_key,
        expires_in_seconds=result.expires_in_seconds,
    )
