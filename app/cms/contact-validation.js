export function validCmsContactPhone(value) {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || value.length > 40 || value.trim() !== value) return false;
  if (!/^\+?[0-9][0-9(). /-]*$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

export function validCmsContactEmail(value) {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || value.length > 254 || value.trim() !== value) return false;

  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (
    local.length > 64 ||
    !/^[^\s@]+$/u.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) return false;

  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(label)) &&
    /^[\p{L}]{2,63}$/u.test(labels.at(-1))
  );
}
