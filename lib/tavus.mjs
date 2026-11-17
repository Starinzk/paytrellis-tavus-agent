// Minimal Tavus API client shared by the server and the scripts.
// Docs: https://docs.tavus.io (PALs, tools, guardrails, objectives, conversations).
import { readFile, writeFile } from "node:fs/promises";

// TAVUS_API_BASE is only overridden by tests, which point it at a local fake.
const BASE = process.env.TAVUS_API_BASE ?? "https://tavusapi.com/v2";

export class TavusError extends Error {
  constructor(method, path, status, body) {
    super(`Tavus ${method} ${path} failed with HTTP ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith("paste-")) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export async function tavus(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": requireEnv("TAVUS_API_KEY") },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new TavusError(method, path, res.status, data);
  return data;
}

// Local state files (git-ignored) that remember IDs created in your Tavus account.
export async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(url, value) {
  await writeFile(url, JSON.stringify(value, null, 2) + "\n");
}

// Pulls the transcript and the post-call perception report out of a verbose
// GET /conversations/{id} response.
export function summarizeConversation(convo) {
  const events = convo.events ?? [];
  const transcript = events.find((e) => e.event_type === "application.transcription_ready");
  const perception = events.find((e) => e.event_type === "application.perception_analysis");
  return {
    status: convo.status ?? "unknown",
    transcript: (transcript?.properties?.transcript ?? []).filter((t) => t.role !== "system"),
    perception: perception?.properties?.analysis ?? null,
  };
}
