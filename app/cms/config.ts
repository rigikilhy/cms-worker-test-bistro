import type { CSSProperties } from "react";

import type { LocaleKey } from "./types";

export type CmsModuleId = "restaurantInfo" | "links" | "openingHours" | "menu" | "featuredImages";
export type CmsTheme = { primary: string; secondary: string; page: string; panel: string; heading: string; body: string; line: string };
export type RestaurantCmsConfig = {
  starterVersion: "1.0.0";
  siteId: string;
  restaurantName: string;
  defaultLocale: LocaleKey;
  locales: readonly LocaleKey[];
  modules: Readonly<{ restaurantInfo: true; links: boolean; openingHours: boolean; menu: boolean; featuredImages: boolean }>;
  imageGroups: { featured: { enabled: boolean; maxItems: number; maxFileBytes: number } };
  theme: CmsTheme;
};

export const restaurantCmsConfig = {
  "starterVersion": "1.0.0",
  "siteId": "test-bistro-two",
  "restaurantName": "Test Bistro Two",
  "defaultLocale": "it",
  "locales": [
    "it",
    "en"
  ],
  "modules": {
    "restaurantInfo": true,
    "links": false,
    "openingHours": true,
    "menu": true,
    "featuredImages": false
  },
  "imageGroups": {
    "featured": {
      "enabled": false,
      "maxItems": 0,
      "maxFileBytes": 1500000
    }
  },
  "theme": {
    "primary": "hsl(28 20% 29%)",
    "secondary": "hsl(28 20% 22%)",
    "page": "hsl(38 35% 94%)",
    "panel": "hsl(40 40% 99%)",
    "heading": "hsl(30 14% 15%)",
    "body": "hsl(30 10% 34%)",
    "line": "hsl(32 20% 79%)"
  }
} as const satisfies RestaurantCmsConfig;

export function cmsThemeStyle(config: RestaurantCmsConfig): CSSProperties {
  return {
    "--cms-primary": config.theme.primary,
    "--cms-secondary": config.theme.secondary,
    "--cms-page": config.theme.page,
    "--cms-panel": config.theme.panel,
    "--cms-heading": config.theme.heading,
    "--cms-body": config.theme.body,
    "--cms-line": config.theme.line,
  } as CSSProperties;
}

export function enabledCmsModules(config: RestaurantCmsConfig): CmsModuleId[] {
  return (Object.entries(config.modules) as Array<[CmsModuleId, boolean]>).filter(([, enabled]) => enabled).map(([module]) => module);
}
