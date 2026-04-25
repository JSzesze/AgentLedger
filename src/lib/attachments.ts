import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { IssueAttachment, IssueContext, RunArchive } from "./types.js";
import { isAgentLedgerComment } from "./runArchive.js";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type CursorImageInput = {
  data: string;
  mimeType: string;
};

type ImageReference = {
  source: string;
  url: string;
  altText?: string;
};

export async function collectIssueAttachments(args: {
  issue: IssueContext;
  archive: RunArchive;
}): Promise<IssueAttachment[]> {
  await mkdir(args.archive.attachmentsDir, { recursive: true });
  const references = extractIssueImageReferences(args.issue);
  const token = await getGithubToken();
  const attachments: IssueAttachment[] = [];

  for (const [index, reference] of references.entries()) {
    const attachment = await downloadImageReference({
      index,
      reference,
      archive: args.archive,
      token,
    });
    attachments.push(attachment);
  }

  await writeFile(args.archive.attachmentsManifestFile, `${JSON.stringify(attachments, null, 2)}\n`);
  return attachments;
}

export async function loadCursorImages(attachments: IssueAttachment[]): Promise<CursorImageInput[]> {
  const images: CursorImageInput[] = [];
  for (const attachment of attachments) {
    if (attachment.status !== "downloaded" || !attachment.localPath || !attachment.mimeType) {
      continue;
    }
    const data = await readFile(attachment.localPath);
    images.push({
      data: data.toString("base64"),
      mimeType: attachment.mimeType,
    });
  }
  return images;
}

export function formatAttachmentsMarkdown(attachments: IssueAttachment[]) {
  if (attachments.length === 0) {
    return "## Attachments\n\n_No issue image attachments were detected._\n";
  }

  return `## Attachments

${attachments
  .map((attachment) => {
    const label = attachment.altText ? ` (${attachment.altText})` : "";
    if (attachment.status === "downloaded") {
      return `- [downloaded] ${attachment.source}${label}: ${attachment.url} -> \`${attachment.localPath}\` (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`;
    }
    return `- [${attachment.status}] ${attachment.source}${label}: ${attachment.url} (${attachment.reason ?? "unknown reason"})`;
  })
  .join("\n")}
`;
}

export function extractIssueImageReferences(issue: IssueContext): ImageReference[] {
  const references: ImageReference[] = [];
  references.push(...extractImageReferences(issue.body, "issue body"));
  for (const comment of issue.comments) {
    if (isAgentLedgerComment(comment.body)) {
      continue;
    }
    references.push(
      ...extractImageReferences(comment.body, `comment by ${comment.author} at ${comment.createdAt}`)
    );
  }

  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.source}\n${reference.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractImageReferences(markdown: string, source: string): ImageReference[] {
  const references: ImageReference[] = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = normalizeImageUrl(match[2] ?? "");
    if (url) {
      references.push({ source, url, altText: match[1] || undefined });
    }
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const url = normalizeImageUrl(match[1] ?? "");
    const altMatch = match[0].match(/\balt=["']([^"']+)["']/i);
    if (url) {
      references.push({ source, url, altText: altMatch?.[1] });
    }
  }
  return references;
}

async function downloadImageReference(args: {
  index: number;
  reference: ImageReference;
  archive: RunArchive;
  token?: string;
}): Promise<IssueAttachment> {
  const base = {
    index: args.index,
    source: args.reference.source,
    url: args.reference.url,
    altText: args.reference.altText,
  };

  try {
    const url = new URL(args.reference.url);
    if (url.protocol !== "https:") {
      return { ...base, status: "skipped", reason: "Only HTTPS image URLs are supported." };
    }

    const headers: Record<string, string> = {};
    if (args.token && isGithubAssetHost(url.hostname)) {
      headers.Authorization = `Bearer ${args.token}`;
    }
    const response = await fetch(args.reference.url, { headers, redirect: "follow" });
    if (!response.ok) {
      return { ...base, status: "failed", reason: `HTTP ${response.status}` };
    }

    const mimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!mimeType || !SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      return {
        ...base,
        status: "skipped",
        reason: `Unsupported content type: ${response.headers.get("content-type") ?? "unknown"}`,
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      return { ...base, status: "skipped", reason: "Image exceeds 15 MB Cursor SDK limit." };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ...base, status: "skipped", reason: "Image exceeds 15 MB Cursor SDK limit." };
    }

    const filename = `issue-image-${String(args.index + 1).padStart(2, "0")}${extensionForMimeType(mimeType)}`;
    const localPath = path.join(args.archive.attachmentsDir, filename);
    await writeFile(localPath, bytes);
    return {
      ...base,
      localPath,
      mimeType,
      sizeBytes: bytes.byteLength,
      status: "downloaded",
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeImageUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeMimeType(value: string | null) {
  return value?.split(";")[0]?.trim().toLowerCase() || "";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function isGithubAssetHost(hostname: string) {
  return (
    hostname === "github.com" ||
    hostname.endsWith(".github.com") ||
    hostname === "githubusercontent.com" ||
    hostname.endsWith(".githubusercontent.com")
  );
}

async function getGithubToken() {
  const result = await execa("gh", ["auth", "token"], { reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : "";
}
