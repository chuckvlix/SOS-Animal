export type CenterSectionType = "CEMZOO_Y_VETERINARIAS" | "INSTITUCIONES_DENUNCIA";

export interface AttentionCenterItem {
  id: string;
  name: string;
  section: CenterSectionType;
  categoryLabel: string;
  badge: string;
  address: string;
  reference?: string;
  latitude: number;
  longitude: number;
  phones: string[];
  email?: string;
  openingHours: string;
  is24Hours: boolean;
  services: string[];
  photoUrl: string;
  photoAlt: string;
  specialNote?: string;
  actionGuide?: string;
}
