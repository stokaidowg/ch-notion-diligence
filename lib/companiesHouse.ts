/**
 * Raw Companies House public data API client.
 *
 * This file is deliberately limited to transport and raw response types:
 * - no normalisation
 * - no Notion
 * - no product decisions
 */

const CH_API_BASE = "https://api.company-information.service.gov.uk";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 3_000;

export type ChResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; body?: string };

export interface ChAddress {
  premises?: string;
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  care_of?: string;
  po_box?: string;
}

export interface ChPreviousCompanyName {
  name?: string;
  effective_from?: string;
  ceased_on?: string;
}

export interface ChCompanyProfile {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  company_status_detail?: string;
  type?: string;
  date_of_creation?: string;
  jurisdiction?: string;
  sic_codes?: string[];
  registered_office_address?: ChAddress;
  can_file?: boolean;
  accounts?: {
    overdue?: boolean;
  };
  confirmation_statement?: {
    overdue?: boolean;
  };
  has_been_liquidated?: boolean;
  has_super_secure_pscs?: boolean;
  registered_office_is_in_dispute?: boolean;
  undeliverable_registered_office_address?: boolean;
  previous_company_names?: ChPreviousCompanyName[];
  links?: {
    exemptions?: string;
    officers?: string;
    persons_with_significant_control?: string;
    filing_history?: string;
    charges?: string;
    insolvency?: string;
    self?: string;
  };
}

export interface ChCompanySearchItem {
  company_number?: string;
  title?: string;
  company_status?: string;
  company_type?: string;
  address_snippet?: string;
  date_of_creation?: string;
  snippet?: string;
}

export interface ChCompanySearchList {
  items?: ChCompanySearchItem[];
  items_per_page?: number;
  kind?: string;
  page_number?: number;
  start_index?: number;
  total_results?: number;
}

export interface ChOfficer {
  name?: string;
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
  nationality?: string;
  country_of_residence?: string;
  occupation?: string;
  date_of_birth?: {
    month?: number;
    year?: number;
  };
  identity_verification_details?: {
    appointment_verification_start_on?: string;
    appointment_verification_end_on?: string;
  };
  person_number?: string;
  is_pre_1992_appointment?: boolean;
  address?: ChAddress;
  links?: {
    self?: string;
    officer?: {
      appointments?: string;
    };
  };
}

export interface ChOfficerList {
  items?: ChOfficer[];
  active_count?: number;
  resigned_count?: number;
  inactive_count?: number;
  total_results?: number;
  items_per_page?: number;
  start_index?: number;
}

export interface ChPsc {
  name?: string;
  name_elements?: {
    title?: string;
    forename?: string;
    middle_name?: string;
    surname?: string;
  };
  natures_of_control?: string[];
  ceased?: boolean;
  date_of_birth?: {
    month?: number;
    year?: number;
  };
  nationality?: string;
  country_of_residence?: string;
  address?: ChAddress;
  identification?: Record<string, unknown>;
  links?: {
    self?: string;
  };
}

export interface ChPscList {
  items?: ChPsc[];
  active_count?: number;
  ceased_count?: number;
  total_results?: number;
  items_per_page?: number;
  start_index?: number;
  links?: {
    self?: string;
    exemptions?: string;
  };
}

export interface ChExemptionEntry {
  items?: Array<{
    exempt_from?: string;
    exempt_to?: string;
  }>;
  exemption_type?: string;
}

export interface ChExemptions {
  exemptions?: Record<string, ChExemptionEntry>;
}

export interface ChFilingHistoryItem {
  transaction_id?: string;
  date?: string;
  type?: string;
  category?: string;
  description?: string;
  pages?: number;
  paper_filed?: boolean | null;
  links?: {
    self?: string;
    document_metadata?: string;
  };
}

export interface ChFilingHistoryList {
  items?: ChFilingHistoryItem[];
  total_count?: number;
  items_per_page?: number;
  start_index?: number;
}

export interface ChChargeTransaction {
  filing_type?: string;
  delivered_on?: string;
  links?: {
    filing?: string;
  };
}

export interface ChCharge {
  charge_number?: number;
  status?: string;
  classification?: {
    description?: string;
    type?: string;
  };
  particulars?: {
    description?: string;
    type?: string;
  };
  created_on?: string;
  delivered_on?: string;
  satisfied_on?: string;
  persons_entitled?: Array<{
    name?: string;
  }>;
  transactions?: ChChargeTransaction[];
}

export interface ChChargeList {
  items?: ChCharge[];
  total_count?: number;
  satisfied_count?: number;
  part_satisfied_count?: number;
}

export interface ChInsolvencyCase {
  type?: string;
  number?: string;
  dates?: Array<{
    date?: string;
    type?: string;
  }>;
  practitioners?: Array<{
    name?: string;
    role?: string;
    appointed_on?: string;
    ceased_to_act_on?: string;
  }>;
  notes?: string[];
}

export interface ChInsolvency {
  status?: string;
  cases?: ChInsolvencyCase[];
}

export interface ChListPage<T> {
  items?: T[];
  total_results?: number;
  total_count?: number;
  items_per_page?: number;
  start_index?: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  pages: number;
  truncated: boolean;
  failure?: {
    status: number;
    error: string;
    body?: string;
  };
}

export type ChPageFetcher<T> = (
  startIndex: number,
  itemsPerPage: number,
) => Promise<ChResult<ChListPage<T>>>;

function authorizationHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

function listQuery(startIndex: number, itemsPerPage: number): string {
  const params = new URLSearchParams({
    start_index: String(startIndex),
    items_per_page: String(itemsPerPage),
  });
  return `?${params.toString()}`;
}

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

function statusError(status: number): string {
  switch (status) {
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 429:
      return "Rate limited";
    default:
      return status >= 500 ? "Upstream server error" : `HTTP ${status}`;
  }
}

export async function chGet<T>(path: string): Promise<ChResult<T>> {
  const apiKey = process.env.CH_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, status: 0, error: "CH_API_KEY is not set" };
  }

  if (!path.startsWith("/")) {
    return { ok: false, status: 0, error: "chGet path must start with /" };
  }

  const url = `${CH_API_BASE}${path}`;
  let lastStatus = 0;
  let lastBody: string | undefined;
  let lastError = "Request failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authorizationHeader(apiKey),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = await response.text();
      lastStatus = response.status;
      lastBody = body;

      if (response.ok) {
        if (body.trim() === "") {
          return {
            ok: false,
            status: response.status,
            error: "Empty response body",
          };
        }

        try {
          return {
            ok: true,
            status: response.status,
            data: JSON.parse(body) as T,
          };
        } catch {
          return {
            ok: false,
            status: response.status,
            error: "Invalid JSON response",
            body,
          };
        }
      }

      lastError = statusError(response.status);

      if (response.status !== 429 && response.status < 500) {
        return {
          ok: false,
          status: response.status,
          error: lastError,
          body: body === "" ? undefined : body,
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
    body: lastBody === "" ? undefined : lastBody,
  };
}

export function getCompanyProfile(
  companyNumber: string,
): Promise<ChResult<ChCompanyProfile>> {
  return chGet<ChCompanyProfile>(
    `/company/${encodeURIComponent(companyNumber)}`,
  );
}

export function searchCompanies(
  query: string,
  startIndex = 0,
  itemsPerPage = 10,
): Promise<ChResult<ChCompanySearchList>> {
  return chGet<ChCompanySearchList>(
    `/search/companies?q=${encodeURIComponent(
      query,
    )}&items_per_page=${itemsPerPage}&start_index=${startIndex}`,
  );
}

export function getOfficers(
  companyNumber: string,
  startIndex = 0,
  itemsPerPage = 50,
): Promise<ChResult<ChOfficerList>> {
  return chGet<ChOfficerList>(
    `/company/${encodeURIComponent(companyNumber)}/officers${listQuery(
      startIndex,
      itemsPerPage,
    )}`,
  );
}

export function getPsc(
  companyNumber: string,
  startIndex = 0,
  itemsPerPage = 50,
): Promise<ChResult<ChPscList>> {
  return chGet<ChPscList>(
    `/company/${encodeURIComponent(
      companyNumber,
    )}/persons-with-significant-control${listQuery(startIndex, itemsPerPage)}`,
  );
}

export function getExemptions(
  companyNumber: string,
): Promise<ChResult<ChExemptions>> {
  return chGet<ChExemptions>(
    `/company/${encodeURIComponent(companyNumber)}/exemptions`,
  );
}

export function getFilingHistory(
  companyNumber: string,
  startIndex = 0,
  itemsPerPage = 50,
): Promise<ChResult<ChFilingHistoryList>> {
  return chGet<ChFilingHistoryList>(
    `/company/${encodeURIComponent(companyNumber)}/filing-history${listQuery(
      startIndex,
      itemsPerPage,
    )}`,
  );
}

export function getCharges(
  companyNumber: string,
  startIndex = 0,
  itemsPerPage = 50,
): Promise<ChResult<ChChargeList>> {
  return chGet<ChChargeList>(
    `/company/${encodeURIComponent(companyNumber)}/charges${listQuery(
      startIndex,
      itemsPerPage,
    )}`,
  );
}

export function getInsolvency(
  companyNumber: string,
): Promise<ChResult<ChInsolvency>> {
  return chGet<ChInsolvency>(
    `/company/${encodeURIComponent(companyNumber)}/insolvency`,
  );
}

export async function paginate<T>(
  fetchPage: ChPageFetcher<T>,
  totalField: "total_results" | "total_count",
  cap: number,
  pageSize = 50,
  firstPage?: ChResult<ChListPage<T>>,
): Promise<ChResult<PagedResult<T>>> {
  if (cap <= 0) {
    return {
      ok: false,
      status: 0,
      error: "Pagination cap must be greater than zero",
    };
  }

  if (pageSize <= 0) {
    return {
      ok: false,
      status: 0,
      error: "Pagination page size must be greater than zero",
    };
  }

  const items: T[] = [];
  let startIndex = 0;
  let pages = 0;
  let total: number | undefined;
  let lastStatus = 0;

  if (firstPage !== undefined) {
    if (!firstPage.ok) {
      return firstPage;
    }

    const firstItems = Array.isArray(firstPage.data.items)
      ? firstPage.data.items
      : [];
    const firstTotal = firstPage.data[totalField];

    if (typeof firstTotal !== "number" || !Number.isFinite(firstTotal)) {
      return {
        ok: false,
        status: firstPage.status,
        error: `Missing ${totalField} in list response`,
      };
    }

    items.push(...firstItems);
    startIndex = firstItems.length;
    pages = 1;
    total = firstTotal;
    lastStatus = firstPage.status;

    if (
      firstItems.length === 0 ||
      startIndex >= firstTotal ||
      items.length >= cap
    ) {
      const cappedItems = items.slice(0, cap);
      return {
        ok: true,
        status: lastStatus,
        data: {
          items: cappedItems,
          total: firstTotal,
          pages,
          truncated: firstTotal > cappedItems.length,
        },
      };
    }
  }

  while (items.length < cap) {
    const page = await fetchPage(startIndex, pageSize);
    pages += 1;

    if (!page.ok) {
      if (pages === 1) {
        return page;
      }

      const cappedItems = items.slice(0, cap);
      return {
        ok: true,
        status: lastStatus,
        data: {
          items: cappedItems,
          total: total ?? 0,
          pages,
          truncated: true,
          failure: {
            status: page.status,
            error: page.error,
            body: page.body,
          },
        },
      };
    }

    lastStatus = page.status;
    const pageItems = Array.isArray(page.data.items) ? page.data.items : [];
    const pageTotal = page.data[totalField];

    if (total === undefined) {
      if (typeof pageTotal !== "number" || !Number.isFinite(pageTotal)) {
        return {
          ok: false,
          status: page.status,
          error: `Missing ${totalField} in list response`,
        };
      }
      total = pageTotal;
    }

    const resolvedTotal = total;
    if (resolvedTotal === undefined) {
      return {
        ok: false,
        status: page.status,
        error: `Missing ${totalField} in list response`,
      };
    }

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);
    startIndex += pageItems.length;

    if (startIndex >= resolvedTotal) {
      break;
    }
  }

  const cappedItems = items.slice(0, cap);
  const resolvedTotal = total ?? 0;

  return {
    ok: true,
    status: lastStatus,
    data: {
      items: cappedItems,
      total: resolvedTotal,
      pages,
      truncated: resolvedTotal > cappedItems.length,
    },
  };
}
