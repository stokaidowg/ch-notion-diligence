import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchCompanies } from "../lib/companiesHouse";
import type { ChCompanySearchItem } from "../lib/companiesHouse";

interface SearchItem {
  number?: string;
  name?: string;
  status?: string;
  type?: string;
  address?: string;
  previousName?: string;
}

function mapItem(item: ChCompanySearchItem): SearchItem {
  const mapped: SearchItem = {
    number: item.company_number,
    name: item.title,
    status: item.company_status,
    type: item.company_type,
    address: item.address_snippet,
  };

  const previousName = item.snippet?.trim();
  if (previousName) {
    mapped.previousName = previousName;
  }

  return mapped;
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

  const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
  const query = rawQuery.trim();

  if (query.length < 2) {
    res.status(400).json({ error: "Enter at least two characters" });
    return;
  }

  try {
    const result = await searchCompanies(query, 0, 10);

    if (!result.ok) {
      res.status(502).json({
        error: "Companies House search failed",
        status: result.status,
      });
      return;
    }

    const items = Array.isArray(result.data.items)
      ? result.data.items.map(mapItem)
      : [];
    const total =
      typeof result.data.total_results === "number"
        ? result.data.total_results
        : 0;

    res.status(200).json({ items, total });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}
