import type { CampaignCreate, CampaignRead, CampaignType } from "../types";
import { apiRequest } from "./api";

export interface CampaignListParams {
  campaign_type?: CampaignType;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function fetchCampaigns(params: CampaignListParams = {}): Promise<CampaignRead[]> {
  const query = new URLSearchParams();
  if (params.campaign_type) {
    query.set("campaign_type", params.campaign_type);
  }
  if (params.active_only) {
    query.set("active_only", "true");
  }
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  return apiRequest<CampaignRead[]>(`/campaigns?${query.toString()}`);
}

export function createCampaign(payload: CampaignCreate): Promise<CampaignRead> {
  return apiRequest<CampaignRead>("/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function replaceCampaign(
  campaignId: number,
  payload: CampaignCreate,
): Promise<CampaignRead> {
  return apiRequest<CampaignRead>(`/campaigns/${campaignId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteCampaign(campaignId: number): Promise<void> {
  return apiRequest<void>(`/campaigns/${campaignId}`, {
    method: "DELETE",
  });
}
