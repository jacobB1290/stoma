import packageJson from "../package.json";

export const APP_VERSION = packageJson.version;

export function compareVersions(a, b) {
  const aParts = String(a || "0")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const bParts = String(b || "0")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);

  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const left = aParts[i] || 0;
    const right = bParts[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
