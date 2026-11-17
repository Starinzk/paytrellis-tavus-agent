// Minimal Tavus API helper shared by the scripts.
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://tavusapi.com/v2";
const STATE_FILE = new URL("../.risk-test.json", import.meta.url);

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith("paste-")) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

export async function tavus(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": requireEnv("TAVUS_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    console.error(`Tavus ${method} ${path} failed with HTTP ${res.status}:`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

export async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    console.error("No test call found. Run `npm run risk-test` first.");
    process.exit(1);
  }
}
