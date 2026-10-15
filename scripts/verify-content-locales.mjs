import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateContentLocales(content) {
  const errors = [];
  function check(value, label, required = false) {
    if (value === undefined && !required) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be an Italian/English text object.`);
      return;
    }
    if (Object.keys(value).some((key) => !["it", "en"].includes(key)) ||
        Object.values(value).some((text) => typeof text !== "string")) {
      errors.push(`${label} must contain only it/en string values.`);
      return;
    }
    const used = required || Object.values(value).some((text) => text.trim());
    if (used) for (const locale of ["it", "en"]) {
      if (!value[locale]?.trim()) errors.push(`${label}.${locale} is required.`);
    }
  }
  check(content?.site?.name, "site.name", true);
  for (const key of ["tagline", "description"]) check(content?.site?.[key], `site.${key}`);
  for (const [i, dish] of (content?.site?.featuredDishes ?? []).entries()) {
    check(dish.name, `site.featuredDishes[${i}].name`, true);
    check(dish.image?.alt, `site.featuredDishes[${i}].image.alt`);
  }
  for (const [i, hour] of (content?.openingHours ?? []).entries()) check(hour.note, `openingHours[${i}].note`);
  for (const [i, category] of (content?.menuCategories ?? []).entries()) {
    const prefix = `menuCategories[${i}]`;
    check(category.title, `${prefix}.title`, true);
    check(category.description, `${prefix}.description`);
    for (const [j, item] of (category.items ?? []).entries()) {
      check(item.name, `${prefix}.items[${j}].name`, true);
      check(item.description, `${prefix}.items[${j}].description`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node verify-content-locales.mjs <content.json>");
    const errors = validateContentLocales(JSON.parse(await readFile(process.argv[2], "utf8")));
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Italian/English content completeness passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
