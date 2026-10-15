import path from "node:path";

export function resolveConfigResource(root, configuredPath, label = "resource") {
  if (typeof configuredPath !== "string" || !configuredPath.trim()) {
    throw new Error(`${label} must be a non-empty path.`);
  }
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`${label} must be relative to the configuration file.`);
  }
  const resolved = path.resolve(root, configuredPath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the configuration directory.`);
  }
  return resolved;
}
