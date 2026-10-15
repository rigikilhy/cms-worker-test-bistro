export type LocaleKey = "it" | "en";

export type LocalizedText = Partial<Record<LocaleKey, string>>;

export type CmsLink = {
  label: string;
  href: string;
};

export type CmsImage = {
  path: string;
  alt?: LocalizedText;
};

export type PostalAddress = {
  streetAddress: string;
  postalCode: string;
  addressLocality: string;
  addressRegion?: string;
  addressCountry: string;
};

export type FeaturedDish = {
  id: string;
  name: LocalizedText;
  image: CmsImage;
  sortOrder: number;
};

export type CmsDocument = {
  version: 1;
  updatedAt: string;
  site: RestaurantInfo;
  openingHours: OpeningHour[];
  menuCategories: MenuCategory[];
};

export function normalizeCmsDocumentForModules(
  document: CmsDocument,
  modules: {
    links: boolean;
    openingHours: boolean;
    menu: boolean;
    featuredImages: boolean;
  },
): CmsDocument {
  return {
    ...document,
    site: {
      ...document.site,
      orderLinks: modules.links ? document.site.orderLinks ?? [] : document.site.orderLinks,
      socialLinks: modules.links ? document.site.socialLinks ?? [] : document.site.socialLinks,
      featuredDishes: modules.featuredImages
        ? document.site.featuredDishes ?? []
        : document.site.featuredDishes,
    },
    openingHours: modules.openingHours ? document.openingHours ?? [] : document.openingHours,
    menuCategories: modules.menu ? document.menuCategories ?? [] : document.menuCategories,
  };
}

export type RestaurantInfo = {
  name: LocalizedText;
  tagline?: LocalizedText;
  description?: LocalizedText;
  metaTitle?: LocalizedText;
  metaDescription?: LocalizedText;
  phone?: string;
  email?: string;
  address?: PostalAddress;
  googleMapsUrl?: string;
  bookingHref?: string;
  orderUrl?: string;
  reservationUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  orderLinks?: CmsLink[];
  socialLinks?: CmsLink[];
  featuredDishes?: FeaturedDish[];
};

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type OpeningHour = {
  dayKey: DayKey;
  lunchOpen?: string;
  lunchClose?: string;
  dinnerOpen?: string;
  dinnerClose?: string;
  closed?: boolean;
  sortOrder: number;
  note?: LocalizedText;
};

export type MenuCategory = {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  sortOrder: number;
  items: MenuItem[];
};

export type MenuItem = {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  price: string;
  available?: boolean;
  dietaryLabels?: string[];
  sortOrder: number;
};
