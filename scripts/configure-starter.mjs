import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveConfigResource } from "./config-resource.mjs";
import { validateContentLocales } from "./verify-content-locales.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.config) fail("Usage: node scripts/configure-starter.mjs --config <file> [--target <directory>]");

const target = path.resolve(args.target ?? process.cwd());
const configPath = path.resolve(args.config);
const sourceDirectory = path.dirname(configPath);
const settings = JSON.parse(await readFile(configPath, "utf8"));
validateSettings(settings);

const contentPath = safeConfigResource(sourceDirectory, settings.contentSource, "contentSource");
const content = JSON.parse(await readFile(contentPath, "utf8"));
validateContent(content, settings);

if (settings.publicSource) {
  await cp(safeConfigResource(sourceDirectory, settings.publicSource, "publicSource"), path.join(target, "public"), {
    recursive: true,
  });
}
await replaceSiteContent(target, settings.siteId, content);
await writeFile(path.join(target, "app/cms/config.ts"), renderCmsConfig(settings));
await writeFile(path.join(target, "app/admin/page.tsx"), renderAdminPage(settings.siteId));
await writeFile(path.join(target, "wrangler.jsonc"), `${JSON.stringify(renderPagesWrangler(settings), null, 2)}\n`);
await writeFile(path.join(target, "cms.client.json"), `${JSON.stringify(renderCoordinatorClient(settings), null, 2)}\n`);

process.stdout.write(`Configured CMS starter for ${settings.restaurantName} (${settings.siteId}).\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    if (!key || values[index + 1] === undefined) fail(`Missing value for ${values[index] ?? "argument"}.`);
    parsed[key] = values[index + 1];
  }
  return parsed;
}

function validateSettings(value) {
  const moduleNames = ["restaurantInfo", "links", "openingHours", "menu", "featuredImages"];
  const themeNames = ["primary", "secondary", "page", "panel", "heading", "body", "line"];
  if (!value || typeof value !== "object") fail("Configuration must be an object.");
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(value.siteId ?? "")) fail("siteId must use lowercase letters, numbers, and hyphens.");
  for (const field of ["restaurantName", "pagesProjectName", "githubOwner", "githubRepo", "githubBranch", "coordinatorUrl", "contentSource"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) fail(`${field} is required.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value.pagesProjectName)) {
    fail("pagesProjectName must be a lowercase Cloudflare project name up to 58 characters.");
  }
  if (value.publicSource !== undefined && (typeof value.publicSource !== "string" || !value.publicSource.trim())) {
    fail("publicSource must be a directory path when provided.");
  }
  if (!/^https:\/\//.test(value.coordinatorUrl)) fail("coordinatorUrl must be an HTTPS URL.");
  if (!/^[A-Za-z0-9_.-]+$/.test(value.githubOwner) || !/^[A-Za-z0-9_.-]+$/.test(value.githubRepo)) {
    fail("githubOwner and githubRepo contain unsupported characters.");
  }
  if (value.githubBranch.length > 255 || /[\s~^:?*[\\]/.test(value.githubBranch)) fail("githubBranch is invalid.");
  if (value.defaultLocale !== "it") fail('defaultLocale must be "it".');
  if (!Array.isArray(value.locales) || value.locales.length !== 2 || value.locales[0] !== "it" || value.locales[1] !== "en") {
    fail('locales must be exactly ["it", "en"] in that order.');
  }
  if (!value.modules || value.modules.restaurantInfo !== true || moduleNames.some((name) => typeof value.modules[name] !== "boolean")) {
    fail("All module flags are required and restaurantInfo must stay enabled.");
  }
  if (!value.imageGroups?.featured || !Number.isInteger(value.imageGroups.featured.maxItems) || !Number.isInteger(value.imageGroups.featured.maxFileBytes)) {
    fail("Featured image limits are required.");
  }
  if (value.imageGroups.featured.maxItems < 0 || value.imageGroups.featured.maxItems > 12) fail("Featured image maxItems must be from 0 to 12.");
  if (value.imageGroups.featured.maxFileBytes < 10_000 || value.imageGroups.featured.maxFileBytes > 5_000_000) fail("Featured image maxFileBytes is outside the supported range.");
  if (value.imageGroups.featured.enabled !== value.modules.featuredImages) fail("featuredImages and imageGroups.featured.enabled must match.");
  if (!Number.isInteger(value.publishLimit) || value.publishLimit < 1 || value.publishLimit > 100) fail("publishLimit must be from 1 to 100.");
  if (!value.theme || themeNames.some((name) => !validCssColor(value.theme[name]))) {
    fail("Every CMS theme color is required.");
  }
}

function validateContent(content, settings) {
  if (!content || content.version !== 1 || !content.site || !Array.isArray(content.openingHours) || !Array.isArray(content.menuCategories)) {
    fail("contentSource is not a version 1 CMS document.");
  }
  const localeErrors = validateContentLocales(content);
  if (localeErrors.length) fail(localeErrors.join("\n"));
  if ((content.site.featuredDishes?.length ?? 0) > settings.imageGroups.featured.maxItems) {
    fail("contentSource exceeds the configured featured image limit.");
  }
  if (!settings.modules.featuredImages && (content.site.featuredDishes?.length ?? 0) > 0) fail("contentSource has featured dishes while that module is disabled.");
  if (!settings.modules.openingHours && content.openingHours.length > 0) fail("contentSource has opening hours while that module is disabled.");
  if (!settings.modules.menu && content.menuCategories.length > 0) fail("contentSource has menu categories while that module is disabled.");
  if (!settings.modules.links && ((content.site.orderLinks?.length ?? 0) > 0 || (content.site.socialLinks?.length ?? 0) > 0)) {
    fail("contentSource has links while that module is disabled.");
  }
}

async function replaceSiteContent(root, siteId, content) {
  const sitesRoot = path.join(root, "content/sites");
  await mkdir(sitesRoot, { recursive: true });
  if (siteId !== "example-restaurant") {
    await rm(path.join(sitesRoot, "example-restaurant"), { recursive: true, force: true });
  }
  const destination = path.join(sitesRoot, siteId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "content.json"), `${JSON.stringify(content, null, 2)}\n`);
}

function validCssColor(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  return /^(?:#[a-f0-9]{3,8}|(?:rgb|hsl)a?\([0-9.%+\-/, ]+\))$/i.test(value.trim());
}

function safeConfigResource(root, configuredPath, label) {
  try {
    return resolveConfigResource(root, configuredPath, label);
  } catch (error) {
    fail(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function renderCmsConfig(settings) {
  return `import type { CSSProperties } from "react";

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

export const restaurantCmsConfig = ${JSON.stringify({
    starterVersion: "1.0.0",
    siteId: settings.siteId,
    restaurantName: settings.restaurantName,
    defaultLocale: settings.defaultLocale,
    locales: settings.locales,
    modules: settings.modules,
    imageGroups: settings.imageGroups,
    theme: settings.theme,
  }, null, 2)} as const satisfies RestaurantCmsConfig;

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
`;
}

function renderAdminPage(siteId) {
  return `import type { Metadata } from "next";

import cmsDocument from "../../content/sites/${siteId}/content.json";
import { AdminEditor } from "../cms/admin-editor";
import { restaurantCmsConfig } from "../cms/config";
import type { CmsDocument } from "../cms/types";
import "../cms/styles.css";

export const metadata: Metadata = {
  title: \`${"${restaurantCmsConfig.restaurantName}"} CMS\`,
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminEditor config={restaurantCmsConfig} initialContent={cmsDocument as CmsDocument} />;
}
`;
}

function renderPagesWrangler(settings) {
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: settings.pagesProjectName,
    compatibility_date: "2026-07-15",
    pages_build_output_dir: "out",
    vars: {
      SITE_ID: settings.siteId,
      CMS_CONTENT_PATH: `content/sites/${settings.siteId}/content.json`,
      CMS_DEFAULT_LOCALE: settings.defaultLocale,
      CMS_LOCALES: settings.locales.join(","),
      CMS_MODULES: Object.entries(settings.modules).filter(([, enabled]) => enabled).map(([name]) => name).join(","),
      GITHUB_OWNER: settings.githubOwner,
      GITHUB_REPO: settings.githubRepo,
      GITHUB_BRANCH: settings.githubBranch,
      CMS_COORDINATOR_URL: settings.coordinatorUrl,
      CMS_PUBLISH_LIMIT_MONTHLY: String(settings.publishLimit),
      CMS_BODY_LIMIT_BYTES: "196608",
      CMS_IMAGE_UPLOAD_BODY_LIMIT_BYTES: "2500000",
      CMS_IMAGE_FILE_LIMIT_BYTES: String(settings.imageGroups.featured.maxFileBytes),
      CMS_FEATURED_IMAGE_MAX_ITEMS: String(settings.imageGroups.featured.maxItems),
    },
  };
}

function renderCoordinatorClient(settings) {
  return {
    clientId: settings.siteId,
    kvKey: `client:${settings.siteId}:config`,
    config: {
      deployTokenHash: "REPLACE_WITH_SHA256_OF_PER_CLIENT_TOKEN",
      repositoryOwner: settings.githubOwner,
      repositoryName: settings.githubRepo,
      branch: settings.githubBranch,
      workflowId: "deploy-pages.yml",
      publishLimit: settings.publishLimit,
      debounceSeconds: 30,
    },
  };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
