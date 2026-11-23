import { buildPageContent } from "./blocks";
import type { NotionBlock } from "./blocks";
import type { CompanyBrief } from "./companyBrief";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 3_000;
const MAX_BLOCKS_PER_REQUEST = 100;

export interface NotionWarning {
  section: string;
  code: string;
  message: string;
  httpStatus?: number;
}

export type NotionFailure = {
  ok: false;
  status: number;
  error: string;
};

export type CreatePageResult =
  | {
      ok: true;
      id: string;
      url: string;
    }
  | NotionFailure;

export type AppendBlocksResult =
  | {
      ok: true;
      appended: number;
    }
  | NotionFailure;

export type WriteBriefResult =
  | {
      ok: true;
      url: string;
      id: string;
      warnings: NotionWarning[];
    }
  | NotionFailure;

type NotionRequestResult =
  | {
      ok: true;
      status: number;
      data: unknown;
    }
  | NotionFailure;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

function backoffDelay(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return Math.round(base * (0.5 + Math.random()));
}

function truncateTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length <= 2000
    ? title
    : characters.slice(0, 2000).join("");
}

function truncateError(message: string): string {
  const characters = Array.from(message);
  return characters.length <= 300
    ? message
    : `${characters.slice(0, 300).join("")}...`;
}

function errorFromResponse(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim() !== "") {
      return `Notion request failed: ${truncateError(parsed.message.trim())}`;
    }
  } catch {
    // Fall through to the generic message.
  }

  return `Notion request failed (HTTP ${status})`;
}

async function notionRequest(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<NotionRequestResult> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    return { ok: false, status: 0, error: "NOTION_TOKEN is not set" };
  }

  if (!path.startsWith("/")) {
    return { ok: false, status: 0, error: "Invalid Notion API path" };
  }

  const url = `${NOTION_API_BASE}${path}`;
  let lastStatus = 0;
  let lastError = "Notion request failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await response.text();
      lastStatus = response.status;

      if (response.ok) {
        if (text.trim() === "") {
          return {
            ok: false,
            status: response.status,
            error: "Notion returned an empty response",
          };
        }

        try {
          return {
            ok: true,
            status: response.status,
            data: JSON.parse(text) as unknown,
          };
        } catch {
          return {
            ok: false,
            status: response.status,
            error: "Notion returned an invalid JSON response",
          };
        }
      }

      lastError = errorFromResponse(response.status, text);

      if (response.status !== 429 && response.status < 500) {
        return {
          ok: false,
          status: response.status,
          error: lastError,
        };
      }

      if (attempt === MAX_ATTEMPTS) {
        break;
      }

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const delay =
        retryAfter === undefined
          ? backoffDelay(attempt)
          : Math.min(retryAfter, MAX_RETRY_AFTER_MS);
      await sleep(delay);
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "Request timed out"
            : "Network request failed",
      };
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError,
  };
}

export async function createPage(title: string): Promise<CreatePageResult> {
  const parentId = process.env.NOTION_PARENT_PAGE_ID?.trim();
  if (!parentId) {
    return {
      ok: false,
      status: 0,
      error: "NOTION_PARENT_PAGE_ID is not set",
    };
  }

  const result = await notionRequest("POST", "/pages", {
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: {
              content: truncateTitle(title),
            },
          },
        ],
      },
    },
  });

  if (!result.ok) {
    return result;
  }

  const data = result.data;
  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      status: result.status,
      error: "Notion create response was not an object",
    };
  }

  const page = data as { id?: unknown; url?: unknown };
  if (typeof page.id !== "string" || typeof page.url !== "string") {
    return {
      ok: false,
      status: result.status,
      error: "Notion create response did not include id and url",
    };
  }

  return {
    ok: true,
    id: page.id,
    url: page.url,
  };
}

export async function appendBlocks(
  pageId: string,
  blocks: NotionBlock[],
): Promise<AppendBlocksResult> {
  const trimmedPageId = pageId.trim();
  if (!trimmedPageId) {
    return {
      ok: false,
      status: 0,
      error: "A Notion page id is required",
    };
  }

  if (blocks.length === 0) {
    return { ok: true, appended: 0 };
  }

  let appended = 0;

  for (
    let index = 0;
    index < blocks.length;
    index += MAX_BLOCKS_PER_REQUEST
  ) {
    const chunk = blocks.slice(index, index + MAX_BLOCKS_PER_REQUEST);
    const result = await notionRequest(
      "PATCH",
      `/blocks/${encodeURIComponent(trimmedPageId)}/children`,
      { children: chunk },
    );

    if (!result.ok) {
      return result;
    }

    appended += chunk.length;
  }

  return { ok: true, appended };
}

export async function writeBrief(
  brief: CompanyBrief,
): Promise<WriteBriefResult> {
  const content = buildPageContent(brief);
  const page = await createPage(content.title);

  if (!page.ok) {
    return page;
  }

  const warnings: NotionWarning[] = [];

  for (const section of content.sections) {
    if (section.blocks.length === 0) {
      continue;
    }

    const result = await appendBlocks(page.id, section.blocks);

    if (!result.ok) {
      warnings.push({
        section: section.key,
        code: "notion_append_failed",
        message: result.error,
        httpStatus: result.status > 0 ? result.status : undefined,
      });
    }
  }

  return {
    ok: true,
    url: page.url,
    id: page.id,
    warnings,
  };
}
