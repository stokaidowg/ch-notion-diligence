import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildBrief } from "../lib/buildBrief";

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

    res.status(200).json({
      brief: result.brief,
      warnings: result.brief.warnings,
      trace: result.trace,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}
