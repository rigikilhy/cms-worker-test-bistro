import type { Metadata } from "next";

import cmsDocument from "../../content/sites/test-bistro-two/content.json";
import { AdminEditor } from "../cms/admin-editor";
import { restaurantCmsConfig } from "../cms/config";
import type { CmsDocument } from "../cms/types";
import "../cms/styles.css";

export const metadata: Metadata = {
  title: `${restaurantCmsConfig.restaurantName} CMS`,
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminEditor config={restaurantCmsConfig} initialContent={cmsDocument as CmsDocument} />;
}
