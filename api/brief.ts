import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  chGet,
  getCharges,
  getCompanyProfile,
  getFilingHistory,
  getInsolvency,
  getOfficers,
  getPsc,
  paginate,
} from "../lib/companiesHouse";
import type {
  ChCharge,
  ChChargeList,
  ChExemptions,
  ChFilingHistoryItem,
  ChFilingHistoryList,
  ChListPage,
  ChOfficer,
  ChOfficerList,
  ChPsc,
  ChPscList,
  ChResult,
  PagedResult,
} from "../lib/companiesHouse";
import { buildCompanyBrief, exemptionsPath } from "../lib/companyBrief";
import type { BriefWarning } from "../lib/companyBrief";

const OFFICER_CAP = 200;
const OFFICER_PAGE_SIZE = 50;
const PSC_CAP = 100;
const PSC_PAGE_SIZE = 50;
const FILINGS_CAP = 15;
const FILINGS_PAGE_SIZE = 15;
const CHARGES_CAP = 100;
const CHARGES_PAGE_SIZE = 50;

type PagedSection = "officers" | "psc" | "filings" | "charges";

function normaliseCompanyNumber(value: string): string | undefined {
  const compact = value.trim().replace(/\s+/g, "").toUpperCase();

  if (/^\d{1,8}$/.test(compact)) {
    return compact.padStart(8, "0");
  }

  return /^[A-Z0-9]{8}$/.test(compact) ? compact : undefined;
}

function upstreamStatus(status: number): number | undefined {
  return status > 0 ? status : undefined;
}

function mergePaged<T, TPage extends ChListPage<T>>(
  firstPage: ChResult<TPage>,
  paged: ChResult<PagedResult<T>>,
  section: PagedSection,
  label: string,
  warnings: BriefWarning[],
): ChResult<TPage> {
  if (!firstPage.ok) {
    return firstPage;
  }

  if (!paged.ok) {
    warnings.push({
      section,
      code: `${section}_partial`,
      message: `${label} pagination failed: ${paged.error}`,
      httpStatus: upstreamStatus(paged.status),
    });
    return firstPage;
  }

  if (paged.data.failure) {
    warnings.push({
      section,
      code: `${section}_partial`,
      message: `${label} pagination stopped: ${paged.data.failure.error}`,
      httpStatus: upstreamStatus(paged.data.failure.status),
    });
  }

  return {
    ok: true,
    status: firstPage.status,
    data: {
      ...firstPage.data,
      items: paged.data.items,
    } as TPage,
  };
}

async function fetchOfficers(
  companyNumber: string,
  warnings: BriefWarning[],
): Promise<ChResult<ChOfficerList>> {
  const firstPage = await getOfficers(companyNumber, 0, OFFICER_PAGE_SIZE);
  const paged = await paginate<ChOfficer>(
    (startIndex, itemsPerPage) =>
      getOfficers(companyNumber, startIndex, itemsPerPage),
    "total_results",
    OFFICER_CAP,
    OFFICER_PAGE_SIZE,
    firstPage,
  );

  return mergePaged(firstPage, paged, "officers", "Officers", warnings);
}

async function fetchPsc(
  companyNumber: string,
  warnings: BriefWarning[],
): Promise<ChResult<ChPscList>> {
  const firstPage = await getPsc(companyNumber, 0, PSC_PAGE_SIZE);
  const paged = await paginate<ChPsc>(
    (startIndex, itemsPerPage) =>
      getPsc(companyNumber, startIndex, itemsPerPage),
    "total_results",
    PSC_CAP,
    PSC_PAGE_SIZE,
    firstPage,
  );

  return mergePaged(firstPage, paged, "psc", "PSC", warnings);
}

async function fetchFilings(
  companyNumber: string,
  warnings: BriefWarning[],
): Promise<ChResult<ChFilingHistoryList>> {
  const firstPage = await getFilingHistory(
    companyNumber,
    0,
    FILINGS_PAGE_SIZE,
  );
  const paged = await paginate<ChFilingHistoryItem>(
    (startIndex, itemsPerPage) =>
      getFilingHistory(companyNumber, startIndex, itemsPerPage),
    "total_count",
    FILINGS_CAP,
    FILINGS_PAGE_SIZE,
    firstPage,
  );

  return mergePaged(firstPage, paged, "filings", "Filings", warnings);
}

async function fetchCharges(
  companyNumber: string,
  warnings: BriefWarning[],
): Promise<ChResult<ChChargeList>> {
  const firstPage = await getCharges(companyNumber, 0, CHARGES_PAGE_SIZE);
  const paged = await paginate<ChCharge>(
    (startIndex, itemsPerPage) =>
      getCharges(companyNumber, startIndex, itemsPerPage),
    "total_count",
    CHARGES_CAP,
    CHARGES_PAGE_SIZE,
    firstPage,
  );

  return mergePaged(firstPage, paged, "charges", "Charges", warnings);
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

  const rawNumber = req.query.number;
  if (typeof rawNumber !== "string") {
    res.status(400).json({ error: "Enter a valid company number" });
    return;
  }

  const companyNumber = normaliseCompanyNumber(rawNumber);
  if (!companyNumber) {
    res.status(400).json({ error: "Enter a valid company number" });
    return;
  }

  try {
    const profile = await getCompanyProfile(companyNumber);

    if (!profile.ok) {
      if (profile.status === 404) {
        res.status(404).json({ error: "Company not found" });
        return;
      }

      res.status(502).json({
        error: "Companies House unavailable",
        status: profile.status,
      });
      return;
    }

    const paginationWarnings: BriefWarning[] = [];

    const [officers, pscResult, filings, charges, insolvency] =
      await Promise.all([
        fetchOfficers(companyNumber, paginationWarnings),
        (async () => {
          const psc = await fetchPsc(companyNumber, paginationWarnings);
          const path = exemptionsPath(psc, profile.data);
          const exemptions = path
            ? await chGet<ChExemptions>(path)
            : undefined;
          return { psc, exemptions };
        })(),
        fetchFilings(companyNumber, paginationWarnings),
        fetchCharges(companyNumber, paginationWarnings),
        getInsolvency(companyNumber),
      ]);

    const built = buildCompanyBrief({
      companyNumber,
      generatedAt: new Date().toISOString(),
      profile: profile.data,
      officers,
      psc: pscResult.psc,
      exemptions: pscResult.exemptions,
      filings,
      charges,
      insolvency,
    });

    built.warnings.push(...paginationWarnings);

    res.status(200).json({
      brief: built.brief,
      warnings: built.brief.warnings,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}
