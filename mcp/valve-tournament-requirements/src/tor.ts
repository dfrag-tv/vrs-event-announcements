import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GITHUB_BLOB_URL =
  "https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/tournament-operation-requirements.md";

export const RAW_URL =
  "https://raw.githubusercontent.com/ValveSoftware/counter-strike_rules_and_regs/main/tournament-operation-requirements.md";

const GITHUB_DIR_API =
  "https://api.github.com/repos/ValveSoftware/counter-strike_rules_and_regs/contents/";

const TOR_FILENAME = "tournament-operation-requirements.md";
const USER_AGENT = "valve-tournament-requirements-mcp";

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DATA_DIR = path.join(PACKAGE_ROOT, "data");
export const DOCUMENT_PATH = path.join(DATA_DIR, TOR_FILENAME);
export const META_PATH = path.join(DATA_DIR, "meta.json");

export type TorMeta = {
  sha: string;
  sha256: string;
  size: number;
  fetchedAt: string;
  checkedAt: string;
  sourceUrl: string;
  rawUrl: string;
};

export type TorDocument = TorMeta & {
  text: string;
  source: "local" | "github";
  updated: boolean;
  warning?: string;
};

export type TorStatus = {
  localPath: string;
  metaPath: string;
  cached: boolean;
  sha: string | null;
  sha256: string | null;
  size: number | null;
  fetchedAt: string | null;
  checkedAt: string | null;
  remoteSha?: string;
  inSync?: boolean;
  updated?: boolean;
  warning?: string;
};

type GithubDirEntry = {
  name: string;
  sha: string;
  size: number;
  type: string;
};

let memory: TorDocument | null = null;

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function toBuffer(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

function buildMeta(text: string, sha: string, fetchedAt: string, checkedAt: string): TorMeta {
  const buffer = toBuffer(text);
  return {
    sha,
    sha256: sha256Hex(buffer),
    size: buffer.length,
    fetchedAt,
    checkedAt,
    sourceUrl: GITHUB_BLOB_URL,
    rawUrl: RAW_URL,
  };
}

async function readLocal(): Promise<TorDocument | null> {
  if (memory) {
    return memory;
  }

  try {
    const [rawText, metaRaw] = await Promise.all([
      readFile(DOCUMENT_PATH, "utf8"),
      readFile(META_PATH, "utf8"),
    ]);
    const text = normalizeText(rawText);
    const meta = JSON.parse(metaRaw) as TorMeta;
    const digest = sha256Hex(toBuffer(text));

    if (meta.sha256 && meta.sha256 !== digest) {
      return null;
    }

    memory = {
      ...meta,
      sha256: digest,
      size: toBuffer(text).length,
      text,
      source: "local",
      updated: false,
    };
    return memory;
  } catch {
    return null;
  }
}

async function writeLocal(text: string, sha: string): Promise<TorDocument> {
  const now = new Date().toISOString();
  const normalized = normalizeText(text);
  const meta = buildMeta(normalized, sha, now, now);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DOCUMENT_PATH, normalized, "utf8");
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  memory = {
    ...meta,
    text: normalized,
    source: "github",
    updated: true,
  };
  return memory;
}

async function touchCheckedAt(document: TorDocument): Promise<TorDocument> {
  const checkedAt = new Date().toISOString();
  const meta: TorMeta = {
    sha: document.sha,
    sha256: document.sha256,
    size: document.size,
    fetchedAt: document.fetchedAt,
    checkedAt,
    sourceUrl: document.sourceUrl,
    rawUrl: document.rawUrl,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  memory = {
    ...document,
    ...meta,
    source: "local",
    updated: false,
  };
  return memory;
}

async function githubFetch(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: HTTP ${response.status} ${response.statusText}`);
  }

  return response;
}

export async function fetchRemoteSha(): Promise<{ sha: string; size: number }> {
  const response = await githubFetch(GITHUB_DIR_API, "application/vnd.github+json", 15_000);
  const entries = (await response.json()) as GithubDirEntry[];
  const entry = entries.find((item) => item.name === TOR_FILENAME && item.type === "file");

  if (!entry) {
    throw new Error(`GitHub directory listing did not include ${TOR_FILENAME}`);
  }

  return { sha: entry.sha, size: entry.size };
}

async function fetchRemoteText(): Promise<string> {
  const response = await githubFetch(RAW_URL, "text/plain", 30_000);
  return normalizeText(await response.text());
}

async function syncFromGithub(local: TorDocument | null): Promise<TorDocument> {
  const remote = await fetchRemoteSha();

  if (local && local.sha === remote.sha) {
    return touchCheckedAt(local);
  }

  const text = await fetchRemoteText();
  return writeLocal(text, remote.sha);
}

export async function getDocument(refresh = false): Promise<TorDocument> {
  const local = await readLocal();

  if (!refresh && local) {
    return local;
  }

  try {
    return await syncFromGithub(local);
  } catch (error) {
    if (!local) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown GitHub error";
    return {
      ...local,
      source: "local",
      updated: false,
      warning: `Using local copy because refresh failed: ${message}`,
    };
  }
}

export async function getStatus(refresh = false): Promise<TorStatus> {
  const local = await readLocal();
  const status: TorStatus = {
    localPath: DOCUMENT_PATH,
    metaPath: META_PATH,
    cached: Boolean(local),
    sha: local?.sha ?? null,
    sha256: local?.sha256 ?? null,
    size: local?.size ?? null,
    fetchedAt: local?.fetchedAt ?? null,
    checkedAt: local?.checkedAt ?? null,
  };

  if (!refresh) {
    return status;
  }

  try {
    const document = await syncFromGithub(local);
    status.cached = true;
    status.sha = document.sha;
    status.sha256 = document.sha256;
    status.size = document.size;
    status.fetchedAt = document.fetchedAt;
    status.checkedAt = document.checkedAt;
    status.remoteSha = document.sha;
    status.inSync = true;
    status.updated = document.updated;
    status.warning = document.warning;
    return status;
  } catch (error) {
    status.warning = error instanceof Error ? error.message : "Unknown GitHub error";
    return status;
  }
}

export type TorSection = {
  heading: string;
  text: string;
};

export function splitSections(text: string): TorSection[] {
  const lines = text.split("\n");
  const sections: TorSection[] = [];
  let heading = "(preamble)";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({ heading, text: body });
    }
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

export function searchDocument(text: string, query: string): TorSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const hits = splitSections(text).filter((section) => section.text.toLowerCase().includes(needle));
  if (hits.length > 0) {
    return hits;
  }

  const lines = text.split("\n");
  const matched: TorSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].toLowerCase().includes(needle)) {
      continue;
    }

    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 3);
    matched.push({
      heading: `line ${index + 1}`,
      text: lines.slice(start, end).join("\n"),
    });
  }

  return matched;
}

export function formatStatus(status: TorStatus): string {
  const lines = [
    "# Tournament Operation Requirements cache",
    "",
    `- **Local copy:** ${status.cached ? "yes" : "no"}`,
    `- **SHA:** ${status.sha ?? "none"}`,
    `- **SHA-256:** ${status.sha256 ?? "none"}`,
    `- **Size:** ${status.size ?? "none"} bytes`,
    `- **Fetched at:** ${status.fetchedAt ?? "none"}`,
    `- **Checked at:** ${status.checkedAt ?? "none"}`,
    `- **Local path:** ${status.localPath}`,
  ];

  if (status.remoteSha) {
    lines.push(`- **Remote SHA:** ${status.remoteSha}`);
    lines.push(`- **In sync:** ${status.inSync ? "yes" : "no"}`);
    lines.push(`- **Updated:** ${status.updated ? "yes" : "no"}`);
  }

  if (status.warning) {
    lines.push(`- **Warning:** ${status.warning}`);
  }

  return lines.join("\n");
}

export function formatDocument(document: TorDocument, extraLines: string[] = []): string {
  return [
    "# Valve Tournament Operation Requirements",
    "",
    `- **Source:** ${document.sourceUrl}`,
    `- **SHA:** ${document.sha}`,
    `- **SHA-256:** ${document.sha256}`,
    `- **Fetched at:** ${document.fetchedAt}`,
    `- **Checked at:** ${document.checkedAt}`,
    `- **Cache:** ${document.source === "local" ? "local copy" : "downloaded from GitHub"}`,
    `- **Updated:** ${document.updated ? "yes" : "no"}`,
    ...(document.warning ? [`- **Warning:** ${document.warning}`] : []),
    ...extraLines,
    "",
    document.text,
  ].join("\n");
}
