import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildBrief } from "../lib/buildBrief";
import type { TraceEntry } from "../lib/buildBrief";
import { writeBrief } from "../lib/notion";

interface PublishWarning {
  section: string;
  code: string;
  message: string;
  httpStatus?: number;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawNumber =
    typeof req.query.number === "string" ? req.query.number : "";

  try {
    const result = await buildBrief(rawNumber);

    if (!result.ok) {
      switch (result.kind) {
        case "invalid":
          res.status(400).json({ error: result.error });
          return;
        case "not_found":
          res.status(404).json({ error: result.error });
          return;
        case "upstream":
          res.status(502).json({
            error: result.error,
            status: result.upstreamStatus,
          });
          return;
        case "internal":
          res.status(500).json({ error: result.error });
          return;
      }
    }

    const started = Date.now();
    const notion = await writeBrief(result.brief);
    const notionMs = Date.now() - started;

    if (!notion.ok) {
      res.status(502).json({
        error: "Notion write failed",
        status: notion.status,
      });
      return;
    }

    const warnings: PublishWarning[] = [
      ...result.brief.warnings.map((warning) => ({
        section: warning.section,
        code: warning.code,
        message: warning.message,
        httpStatus: warning.httpStatus,
      })),
      ...notion.warnings.map((warning) => ({
        section: warning.section,
        code: warning.code,
        message: warning.message,
        httpStatus: warning.httpStatus,
      })),
    ];

    const trace: TraceEntry[] = [
      ...result.trace,
      {
        section: "notion",
        status: 200,
        ms: notionMs,
      },
    ];

    res.status(200).json({
      url: notion.url,
      id: notion.id,
      warnings,
      trace,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}
