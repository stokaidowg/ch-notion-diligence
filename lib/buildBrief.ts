import {
  chGet,
  getCharges,
  getCompanyProfile,
  getFilingHistory,
  getInsolvency,
  getOfficers,
  getPsc,
  paginate,
} from "./companiesHouse";
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
} from "./companiesHouse";
import { buildCompanyBrief, exemptionsPath } from "./companyBrief";
import type { BriefWarning, CompanyBrief } from "./companyBrief";

const OFFICER_CAP = 200;
const OFFICER_PAGE_SIZE = 50;
const PSC_CAP = 100;
const PSC_PAGE_SIZE = 50;
const FILINGS_CAP = 15;
const FILINGS_PAGE_SIZE = 15;
const CHARGES_CAP = 100;
const CHARGES_PAGE_SIZE = 50;

export type TraceEntry = {
  section: string;
  status: number;
  ms: number;
};

export type BuildBriefResult =
  | {
      ok: true;
      brief: CompanyBrief;
      trace: TraceEntry[];
    }
  | {
      ok: false;
      kind: "invalid" | "not_found" | "upstream" | "internal";
      upstreamStatus?: number;
      error: string;
    };

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

async function traced<T extends { status: number }>(
  section: string,
  task: () => Promise<T>,
  trace: TraceEntry[],
): Promise<T> {
  const started = Date.now();

  try {
    const result = await task();
    trace.push({
      section,
      status: result.status,
      ms: Date.now() - started,
    });
    return result;
  } catch (error) {
    trace.push({
      section,
      status: 0,
      ms: Date.now() - started,
    });
    throw error;
  }
}

export async function buildBrief(
  rawNumber: string,
): Promise<BuildBriefResult> {
  const companyNumber = normaliseCompanyNumber(rawNumber);

  if (!companyNumber) {
    return {
      ok: false,
      kind: "invalid",
      error: "Enter a valid company number",
    };
  }

  const trace: TraceEntry[] = [];

  try {
    const profile = await traced(
      "profile",
      () => getCompanyProfile(companyNumber),
      trace,
    );

    if (!profile.ok) {
      if (profile.status === 404) {
        return {
          ok: false,
          kind: "not_found",
          error: "Company not found",
        };
      }

      return {
        ok: false,
        kind: "upstream",
        upstreamStatus: profile.status,
        error: "Companies House unavailable",
      };
    }

    const paginationWarnings: BriefWarning[] = [];

    const [officers, pscResult, filings, charges, insolvency] =
      await Promise.all([
        traced(
          "officers",
          () => fetchOfficers(companyNumber, paginationWarnings),
          trace,
        ),
        (async () => {
          const psc = await traced(
            "psc",
            () => fetchPsc(companyNumber, paginationWarnings),
            trace,
          );
          const path = exemptionsPath(psc, profile.data);

          if (!path) {
            return { psc, exemptions: undefined };
          }

          const exemptions = await traced(
            "exemptions",
            () => chGet<ChExemptions>(path),
            trace,
          );

          return { psc, exemptions };
        })(),
        traced(
          "filings",
          () => fetchFilings(companyNumber, paginationWarnings),
          trace,
        ),
        traced(
          "charges",
          () => fetchCharges(companyNumber, paginationWarnings),
          trace,
        ),
        traced(
          "insolvency",
          () => getInsolvency(companyNumber),
          trace,
        ),
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

    return {
      ok: true,
      brief: built.brief,
      trace,
    };
  } catch {
    return {
      ok: false,
      kind: "internal",
      error: "Internal server error",
    };
  }
}
