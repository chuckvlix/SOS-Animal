from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

import boto3
from botocore.client import BaseClient
from botocore.config import Config

from app.core.config import get_settings

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


def create_s3_client(endpoint_url: str) -> BaseClient:
    """Create a boto3 S3 client configured with SigV4 for MinIO compatibility."""
    current_settings = get_settings()
    lowered = endpoint_url.strip().lower()
    use_ssl = lowered.startswith("https://") or (
        not lowered.startswith("http://") and current_settings.MINIO_USE_SSL
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=current_settings.MINIO_ROOT_USER,
        aws_secret_access_key=current_settings.MINIO_ROOT_PASSWORD,
        region_name="us-east-1",
        use_ssl=use_ssl,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
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
    target_bucket = bucket or current_settings.MINIO_BUCKET_EVIDENCES
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
