// Loads a local .env file if there is one, without overriding variables that are
// already set. Locally the API key lives in .env; on a host (Railway) the same
// variables come from the platform's settings and there is no .env file.
import { readFileSync } from "node:fs";

export function loadDotEnv(url = new URL("../.env", import.meta.url)) {
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return true;
}
