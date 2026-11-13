export type UserRole = "ciudadano" | "gestor_cemzoo" | "admin";

export type OffenseMainType = "MALTRATO" | "BIOCIDIO";

export type ComplaintStatus =
  | "BORRADOR"
  | "ENVIADA"
  | "EN_ATENCION_CEMZOO"
  | "CERRADA";

export type EvidenceType = "FOTO" | "VIDEO" | "DOCUMENTO";

export type CenterCategory = "ZOONOSIS" | "VETERINARIA";

export type CampaignType =
  | "CALENDARIO_VACUNACION"
  | "CAMPANA_ESTERILIZACION"
  | "ATENCION_EMERGENCIA"
  | "PROXIMA_JORNADA";

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
}

export interface AttentionCenterRead {
  id: number;
  name: string;
  category: CenterCategory;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  opening_hours: string;
  is_24_hours: boolean;
  services: string;
  is_active: boolean;
}

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

export interface LegalNormRead {
  id: number;
  title: string;
  summary_text: string;
  pdf_object_key: string | null;
  is_active: boolean;
  updated_at: string;
}
