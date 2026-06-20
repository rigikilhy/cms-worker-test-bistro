import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const clientId = "test-bistro-two";
const root = process.cwd();
const contentPath = path.join(root, "content", "sites", clientId, "content.json");
const outDir = path.join(root, "out");
const content = JSON.parse(await readFile(contentPath, "utf8"));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const locale = "en";
const title = text(content.site.name, locale);
const tagline = text(content.site.tagline, locale);
const description = text(content.site.description, locale);
const menu = content.menuCategories
  .toSorted((a, b) => a.sortOrder - b.sortOrder)
  .map((category) => renderCategory(category, locale))
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeAttribute(description)}">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; }
      body { margin: 0; background: #f3f6f7; color: #1d2528; }
      main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
      header, section, footer { border-bottom: 1px solid #cdd9dd; padding: 24px 0; }
      h1 { margin: 0 0 8px; font-size: clamp(2rem, 6vw, 4rem); line-height: 1; }
      h2 { margin: 0 0 16px; font-size: 1.4rem; }
      p { line-height: 1.5; }
      .menu-item { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 12px 0; }
      .menu-item strong { display: block; }
      .price { font-weight: 700; }
      small { color: #5d6b70; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(tagline)}</p>
        <small>Client ID: ${clientId} | Updated: ${escapeHtml(content.updatedAt)}</small>
      </header>
      <section>
        <h2>Menu</h2>
        ${menu}
      </section>
      <footer>
        <p>${escapeHtml(content.site.address)}<br>${escapeHtml(content.site.phone)}<br>${escapeHtml(content.site.email)}</p>
      </footer>
    </main>
  </body>
</html>
`;

await writeFile(path.join(outDir, "index.html"), html);
await writeFile(path.join(outDir, ".nojekyll"), "");

function renderCategory(category, locale) {
  const items = category.items
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => `<div class="menu-item">
      <div>
        <strong>${escapeHtml(text(item.name, locale))}</strong>
        <span>${escapeHtml(text(item.description, locale))}</span>
      </div>
      <span class="price">${escapeHtml(item.price)}</span>
    </div>`)
    .join("\n");
  return `<article>
    <h3>${escapeHtml(text(category.title, locale))}</h3>
    <p>${escapeHtml(text(category.description, locale))}</p>
    ${items}
  </article>`;
}

function text(value, locale) {
  if (typeof value === "string") return value;
  return value?.[locale] ?? value?.it ?? value?.en ?? "";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
