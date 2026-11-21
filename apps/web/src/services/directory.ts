import type {
  AttentionCenterCreateRequest,
  AttentionCenterRead,
  AttentionCenterUpdateRequest,
  DirectoryFilterParams,
} from "../types";
import { apiRequest } from "./api";

/**
 * Fetch attention centers matching given query filters and coordinates.
 */
export async function fetchAttentionCenters(
  filters: DirectoryFilterParams = {},
): Promise<AttentionCenterRead[]> {
  const params = new URLSearchParams();

  if (filters.category) {
    params.set("category", filters.category);
  }
  if (typeof filters.is_24_hours === "boolean") {
    params.set("is_24_hours", String(filters.is_24_hours));
  }
  if (filters.q && filters.q.trim()) {
    params.set("q", filters.q.trim());
  }
  if (typeof filters.is_active === "boolean") {
    params.set("is_active", String(filters.is_active));
  }
  if (
    typeof filters.user_lat === "number" &&
    typeof filters.user_lng === "number"
  ) {
    params.set("user_lat", filters.user_lat.toFixed(6));
    params.set("user_lng", filters.user_lng.toFixed(6));
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/directory/?${queryString}` : "/directory/";

  return apiRequest<AttentionCenterRead[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Fetch a single attention center by its unique identifier.
 */
export async function fetchAttentionCenterById(
  id: number,
): Promise<AttentionCenterRead> {
  return apiRequest<AttentionCenterRead>(`/directory/${id}`, {
    method: "GET",
  });
}

/**
 * Create a new attention center entry (Admin only).
 */
export async function createAttentionCenter(
  data: AttentionCenterCreateRequest,
): Promise<AttentionCenterRead> {
  return apiRequest<AttentionCenterRead>("/directory/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Partially update an existing attention center (Admin only).
 */
export async function updateAttentionCenter(
  id: number,
  data: AttentionCenterUpdateRequest,
): Promise<AttentionCenterRead> {
  return apiRequest<AttentionCenterRead>(`/directory/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Delete an attention center (Admin only).
 */
export async function deleteAttentionCenter(id: number): Promise<void> {
  return apiRequest<void>(`/directory/${id}`, {
    method: "DELETE",
  });
}
