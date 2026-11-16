export type IconName =
  | "home"
  | "sos"
  | "map"
  | "health"
  | "legal"
  | "education"
  | "cases"
  | "shield"
  | "check"
  | "arrow-right";

export type AccentTone = "primary" | "secondary" | "sos";

export interface NavItem {
  readonly label: string;
  readonly desktopLabel?: string;
  readonly mobileLabel: string;
  readonly href: string;
  readonly icon: IconName;
  readonly isSos?: boolean;
}

export interface HeroAction {
  readonly label: string;
  readonly href: string;
}

export interface StockImageAsset {
  readonly src: string;
  readonly srcSet?: string;
  readonly sizes?: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface HeroContent {
  readonly badge: string;
  readonly titleStart: string;
  readonly titleHighlight: string;
  readonly description: string;
  readonly primaryCta: HeroAction;
  readonly secondaryCta: HeroAction;
  readonly image: StockImageAsset;
}

export interface AboutMissionContent {
  readonly eyebrow: string;
  readonly titleStart: string;
  readonly titleHighlight: string;
  readonly description: string;
  readonly points: readonly string[];
  readonly cta: HeroAction;
  readonly image: StockImageAsset;
}

export interface ProcessStep {
  readonly stepNumber: string;
  readonly title: string;
  readonly description: string;
  readonly tag: string;
  readonly icon: IconName;
  readonly accent: AccentTone;
}

export interface CommunityHighlight {
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly ctaLabel: string;
  readonly accent: "primary" | "secondary";
  readonly image: StockImageAsset;
}

export interface LegalNormHighlight {
  readonly code: string;
  readonly title: string;
  readonly summary: string;
}

export interface FooterLink {
  readonly label: string;
  readonly href: string;
}

export interface FooterLinkGroup {
  readonly title: string;
  readonly links: readonly FooterLink[];
}
