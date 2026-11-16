export type IconName =
  | "home"
  | "sos"
  | "map"
  | "health"
  | "legal"
  | "cases"
  | "arrow-right";

export interface NavItem {
  readonly label: string;
  readonly mobileLabel: string;
  readonly href: string;
  readonly icon: IconName;
  readonly isSos?: boolean;
}

export interface HeroAction {
  readonly label: string;
  readonly href: string;
}

export interface HeroContent {
  readonly badge: string;
  readonly title: string;
  readonly description: string;
  readonly primaryCta: HeroAction;
  readonly secondaryCta: HeroAction;
}

export interface CitizenService {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly badge: string;
  readonly accent: "primary" | "secondary";
  readonly icon: IconName;
}
