import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const clientId = "test-bistro-two";
const note = process.argv.slice(2).join(" ") || "simulated save";
const contentPath = path.join(process.cwd(), "content", "sites", clientId, "content.json");
const content = JSON.parse(await readFile(contentPath, "utf8"));
const now = new Date().toISOString();

content.updatedAt = now;
content.site.tagline.en = `Worker test save at ${now}: ${note}`;
content.site.tagline.it = `Salvataggio test Worker alle ${now}: ${note}`;

await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`);
