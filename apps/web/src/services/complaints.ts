import type {
  ComplaintCreateRequest,
  ComplaintDownloadUrlResponse,
  ComplaintEvidenceCreateRequest,
  ComplaintEvidenceRead,
  ComplaintPreviewResponse,
  ComplaintPublicTrackingRead,
  ComplaintRead,
  ComplaintStatus,
  ComplaintStatusUpdateRequest,
  ComplaintUpdateRequest,
  OffenseCategoryRead,
  OffenseMainType,
} from "../types";
import { apiRequest } from "./api";

export function fetchOffenseCategories(
  mainType?: OffenseMainType,
): Promise<OffenseCategoryRead[]> {
  const qs = mainType ? `?main_type=${encodeURIComponent(mainType)}` : "";
  return apiRequest<OffenseCategoryRead[]>(`/complaints/categories${qs}`);
}

export function fetchPublicTracking(
  trackingCode: string,
): Promise<ComplaintPublicTrackingRead> {
  return apiRequest<ComplaintPublicTrackingRead>(
    `/complaints/track/${encodeURIComponent(trackingCode.trim().toUpperCase())}`,
  );
}

export function fetchMyComplaints(
  limit = 50,
  offset = 0,
): Promise<ComplaintRead[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return apiRequest<ComplaintRead[]>(`/complaints/me?${query.toString()}`);
}

export interface InstitutionalComplaintsParams {
  status?: ComplaintStatus;
  main_type?: OffenseMainType;
  limit?: number;
  offset?: number;
}

export function fetchInstitutionalComplaints(
  params: InstitutionalComplaintsParams = {},
): Promise<ComplaintRead[]> {
  const query = new URLSearchParams();
  if (params.status) {
    query.set("status", params.status);
  }
  if (params.main_type) {
    query.set("main_type", params.main_type);
  }
  if (typeof params.limit === "number") {
    query.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    query.set("offset", String(params.offset));
  }
  const qs = query.toString();
  return apiRequest<ComplaintRead[]>(qs ? `/complaints?${qs}` : "/complaints");
}

export function createDraftComplaint(
  payload: ComplaintCreateRequest,
): Promise<ComplaintRead> {
  return apiRequest<ComplaintRead>("/complaints", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchComplaintById(complaintId: string): Promise<ComplaintRead> {
  return apiRequest<ComplaintRead>(`/complaints/${encodeURIComponent(complaintId)}`);
}

export function updateDraftComplaint(
  complaintId: string,
  payload: ComplaintUpdateRequest,
): Promise<ComplaintRead> {
  return apiRequest<ComplaintRead>(`/complaints/${encodeURIComponent(complaintId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDraftComplaint(complaintId: string): Promise<void> {
  return apiRequest<void>(`/complaints/${encodeURIComponent(complaintId)}`, {
    method: "DELETE",
  });
}

export function attachComplaintEvidence(
  complaintId: string,
  payload: ComplaintEvidenceCreateRequest,
): Promise<ComplaintEvidenceRead> {
  return apiRequest<ComplaintEvidenceRead>(
    `/complaints/${encodeURIComponent(complaintId)}/evidences`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function removeComplaintEvidence(
  complaintId: string,
  evidenceId: string,
): Promise<void> {
  return apiRequest<void>(
    `/complaints/${encodeURIComponent(complaintId)}/evidences/${encodeURIComponent(evidenceId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchComplaintPreview(
  complaintId: string,
): Promise<ComplaintPreviewResponse> {
  return apiRequest<ComplaintPreviewResponse>(
    `/complaints/${encodeURIComponent(complaintId)}/preview`,
  );
}

export function submitComplaint(complaintId: string): Promise<ComplaintRead> {
  return apiRequest<ComplaintRead>(
    `/complaints/${encodeURIComponent(complaintId)}/submit`,
    {
      method: "POST",
    },
  );
}

export function fetchComplaintPdfDownloadUrl(
  complaintId: string,
): Promise<ComplaintDownloadUrlResponse> {
  return apiRequest<ComplaintDownloadUrlResponse>(
    `/complaints/${encodeURIComponent(complaintId)}/pdf`,
  );
}

export function updateInstitutionalComplaintStatus(
  complaintId: string,
  payload: ComplaintStatusUpdateRequest,
): Promise<ComplaintRead> {
  return apiRequest<ComplaintRead>(
    `/complaints/${encodeURIComponent(complaintId)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}
