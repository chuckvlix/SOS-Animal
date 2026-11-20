import type {
  EvidenceType,
  PresignedUploadRequest,
  PresignedUploadResponse,
} from "../types";
import { apiRequest } from "./api";

export const MAX_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MIN_PHOTOS_PER_COMPLAINT = 1;
export const MAX_PHOTOS_PER_COMPLAINT = 3;

export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedEvidenceMimeType = (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number];

const EXTENSION_MIME_FALLBACK: Record<string, AllowedEvidenceMimeType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function resolveAllowedEvidenceMimeType(file: File): AllowedEvidenceMimeType | null {
  const rawMime = file.type.trim().toLowerCase();
  if ((ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(rawMime)) {
    return rawMime as AllowedEvidenceMimeType;
  }

  const lowerName = file.name.trim().toLowerCase();
  for (const [ext, mime] of Object.entries(EXTENSION_MIME_FALLBACK)) {
    if (lowerName.endsWith(ext)) {
      return mime;
    }
  }

  return null;
}

export function validateEvidenceFile(file: File): {
  mimeType: AllowedEvidenceMimeType;
  sizeBytes: number;
} {
  if (file.size <= 0) {
    throw new Error(`La fotografía "${file.name}" está vacía.`);
  }

  if (file.size > MAX_EVIDENCE_FILE_SIZE_BYTES) {
    throw new Error(
      `La fotografía "${file.name}" supera el límite máximo permitido de 25 MB.`,
    );
  }

  const mimeType = resolveAllowedEvidenceMimeType(file);
  if (!mimeType) {
    throw new Error(
      `Formato no permitido para "${file.name}". Solo se aceptan fotografías JPG, PNG o WEBP.`,
    );
  }

  return {
    mimeType,
    sizeBytes: file.size,
  };
}

export function inferEvidenceType(): EvidenceType {
  return "FOTO";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function requestPresignedUpload(
  payload: PresignedUploadRequest,
): Promise<PresignedUploadResponse> {
  return apiRequest<PresignedUploadResponse>("/storage/presigned-upload", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  mimeType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", mimeType.trim().toLowerCase());

    xhr.upload.addEventListener("progress", (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) {
        return;
      }
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(
        new Error(
          `El almacenamiento rechazó el archivo "${file.name}" (HTTP ${xhr.status}).`,
        ),
      );
    });

    xhr.addEventListener("error", () => {
      reject(
        new Error(
          `No se pudo subir "${file.name}" al almacenamiento. Verifica tu conexión o CORS de MinIO.`,
        ),
      );
    });

    xhr.addEventListener("abort", () => {
      reject(new Error(`La subida de "${file.name}" fue cancelada.`));
    });

    xhr.send(file);
  });
}
