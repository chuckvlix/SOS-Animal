export type UserRole = "ciudadano" | "admin";

export type OffenseMainType = "MALTRATO" | "BIOCIDIO";

export type ComplaintStatus = "BORRADOR" | "ENVIADA";

export type EvidenceType = "FOTO";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface UserRead {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  ci_number: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

export interface UserRegisterRequest {
  full_name: string;
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

export interface UserProfileUpdate {
  full_name?: string;
  ci_number?: string;
  phone?: string;
  address?: string;
}

export interface UserRoleUpdate {
  role: UserRole;
}

export interface PresignedUploadRequest {
  mime_type: string;
  file_size_bytes: number;
}

export interface PresignedUploadResponse {
  upload_url: string;
  object_key: string;
  expires_in_seconds: number;
}

export interface OffenseCategoryRead {
  id: number;
  main_type: OffenseMainType;
  subtype_name: string;
  legal_basis: string;
}

export interface ComplaintEvidenceRead {
  id: string;
  complaint_id: string;
  evidence_type: EvidenceType;
  object_key: string;
  mime_type: string;
  file_size_bytes: number;
  created_at: string;
}

export interface ComplaintRead {
  id: string;
  tracking_code: string | null;
  user_id: string;
  offense_category_id: number;
  incident_date: string;
  incident_address: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  status: ComplaintStatus;
  is_immutable: boolean;
  pdf_url: string | null;
  created_at: string;
  submitted_at: string | null;
  offense_category?: OffenseCategoryRead | null;
  evidences: ComplaintEvidenceRead[];
}

export interface ComplaintCreateRequest {
  offense_category_id: number;
  incident_date: string;
  incident_address: string;
  latitude?: number | null;
  longitude?: number | null;
  description: string;
}

export interface ComplaintUpdateRequest {
  offense_category_id?: number;
  incident_date?: string;
  incident_address?: string;
  latitude?: number | null;
  longitude?: number | null;
  description?: string;
}

export interface ComplaintEvidenceCreateRequest {
  evidence_type: EvidenceType;
  object_key: string;
  mime_type: string;
  file_size_bytes: number;
}

export interface ComplaintPreviewResponse {
  complaint_id: string;
  title: "DOCUMENTO DE DENUNCIA";
  html_preview: string;
}

export interface ComplaintDownloadUrlResponse {
  download_url: string;
  object_key: string;
  expires_in_seconds: number;
}

export interface ComplaintCategoryStat {
  category_id: number;
  main_type: OffenseMainType;
  subtype_name: string;
  count: number;
}

export interface ComplaintStatsRead {
  total_submitted: number;
  total_maltrato: number;
  total_biocidio: number;
  total_with_coordinates: number;
  total_photos: number;
  by_category: ComplaintCategoryStat[];
}

export type {
  AttentionCenterItem,
  CenterSectionType,
} from "./centers";

export type CampaignType =
  | "CALENDARIO_VACUNACION"
  | "CAMPANA_ESTERILIZACION"
  | "ATENCION_EMERGENCIA"
  | "PROXIMA_JORNADA";

export interface CampaignRead {
  id: number;
  title: string;
  campaign_type: CampaignType;
  description: string;
  requirements: string | null;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
  institution: string;
  created_by: string;
}

export interface CampaignCreate {
  title: string;
  campaign_type: CampaignType;
  description: string;
  requirements?: string | null;
  location_address: string;
  latitude?: number | null;
  longitude?: number | null;
  start_date: string;
  end_date: string;
  institution: string;
}

export interface CampaignUpdate {
  title?: string;
  campaign_type?: CampaignType;
  description?: string;
  requirements?: string | null;
  location_address?: string;
  latitude?: number | null;
  longitude?: number | null;
  start_date?: string;
  end_date?: string;
  institution?: string;
}
