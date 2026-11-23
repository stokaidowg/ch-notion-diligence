import type {
  ChAddress,
  ChCharge,
  ChChargeList,
  ChCompanyProfile,
  ChExemptions,
  ChFilingHistoryItem,
  ChFilingHistoryList,
  ChInsolvency,
  ChInsolvencyCase,
  ChOfficer,
  ChOfficerList,
  ChPsc,
  ChPscList,
  ChResult,
} from "./companiesHouse";

const CH_PUBLIC_BASE =
  "https://find-and-update.company-information.service.gov.uk";
const FILINGS_SHOWN = 15;
const SATISFIED_EXAMPLES = 5;
const RECENT_RESIGNATIONS = 5;
const NO_PSC_NOTE =
  "No PSC items returned by the API; no exemptions link was present.";

export type IsoDate = string;
export type IsoDateTime = string;

export interface Address {
  premises?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  careOf?: string;
  poBox?: string;
}

export interface CompanyFlags {
  accountsOverdue?: boolean;
  confirmationStatementOverdue?: boolean;
  hasBeenLiquidated?: boolean;
  hasSuperSecurePscs?: boolean;
  registeredOfficeInDispute?: boolean;
  undeliverableRegisteredOffice?: boolean;
}

export interface PreviousName {
  name?: string;
  effectiveFrom?: IsoDate;
  ceasedOn?: IsoDate;
}

export interface CompanySummary {
  number: string;
  // name and status stay optional: the normaliser does not invent data.
  name?: string;
  status?: string;
  statusDetail?: string;
  type?: string;
  incorporatedOn?: IsoDate;
  jurisdiction?: string;
  sicCodes: string[];
  registeredOffice?: Address;
  canFile?: boolean;
  previousNames: PreviousName[];
  flags: CompanyFlags;
  publicUrl: string;
}

export interface Officer {
  name?: string;
  role?: string;
  appointedOn?: IsoDate;
  resignedOn?: IsoDate;
  nationality?: string;
  countryOfResidence?: string;
  occupation?: string;
  dateOfBirth?: {
    month?: number;
    year?: number;
  };
  identityVerificationFrom?: IsoDate;
  personNumber?: string;
  isPre1992Appointment?: boolean;
  address?: Address;
}

export interface OfficersSection {
  status: "ok" | "none" | "unavailable";
  httpStatus?: number;
  activeCount?: number;
  resignedCount?: number;
  inactiveCount?: number;
  totalResults?: number;
  fetched: number;
  active: Officer[];
  recentResignations: Officer[];
  truncated: boolean;
}

export interface PscNature {
  code: string;
  label: string;
}

export interface Psc {
  name?: string;
  nameElements?: {
    title?: string;
    forename?: string;
    middleName?: string;
    surname?: string;
  };
  // Mechanical label plus the raw Companies House code.
  naturesOfControl: PscNature[];
  ceased?: boolean;
  dateOfBirth?: {
    month?: number;
    year?: number;
  };
  nationality?: string;
  countryOfResidence?: string;
  address?: Address;
}

export interface PscExemption {
  key: string;
  exemptionType?: string;
  periods: Array<{
    exemptFrom?: IsoDate;
    exemptTo?: IsoDate;
  }>;
}

export interface PscSection {
  status: "ok" | "none" | "exempt" | "unavailable";
  httpStatus?: number;
  activeCount?: number;
  ceasedCount?: number;
  totalResults?: number;
  fetched: number;
  items: Psc[];
  exemptions: PscExemption[];
  truncated: boolean;
  note?: string;
}

export interface Filing {
  transactionId?: string;
  date?: IsoDate;
  type?: string;
  category?: string;
  description?: string;
  pages?: number;
  paperFiled?: boolean | null;
  publicUrl?: string;
}

export interface FilingsSection {
  status: "ok" | "none" | "unavailable";
  httpStatus?: number;
  totalCount?: number;
  shown: number;
  notShown?: number;
  items: Filing[];
  truncated: boolean;
  publicHistoryUrl: string;
}

export interface Charge {
  chargeNumber?: number;
  status?: string;
  classification?: {
    description?: string;
    type?: string;
  };
  particulars?: {
    description?: string;
    type?: string;
  };
  createdOn?: IsoDate;
  deliveredOn?: IsoDate;
  satisfiedOn?: IsoDate;
  personsEntitled?: Array<{
    name?: string;
  }>;
  transactions?: Array<{
    filingType?: string;
    deliveredOn?: IsoDate;
    publicFilingUrl?: string;
  }>;
}

export interface ChargesSection {
  status: "ok" | "none" | "unavailable";
  httpStatus?: number;
  totalCount?: number;
  satisfiedCount?: number;
  partSatisfiedCount?: number;
  fetched: number;
  items: Charge[];
  outstanding: Charge[];
  satisfied: Charge[];
  satisfiedExamples: Charge[];
  truncated: boolean;
}

export interface InsolvencyCase {
  type?: string;
  number?: string;
  dates: Array<{
    date?: IsoDate;
    type?: string;
  }>;
  practitioners: Array<{
    name?: string;
    role?: string;
    appointedOn?: IsoDate;
    ceasedToActOn?: IsoDate;
  }>;
  notes?: string[];
}

export interface InsolvencySection {
  status: "none" | "cases" | "unavailable";
  httpStatus?: number;
  insolvencyStatus?: string;
  cases: InsolvencyCase[];
}

export type BriefSection =
  | "profile"
  | "officers"
  | "psc"
  | "exemptions"
  | "filings"
  | "charges"
  | "insolvency";

export interface BriefWarning {
  section: BriefSection;
  code: string;
  message: string;
  httpStatus?: number;
}

export interface CompanyBrief {
  generatedAt: IsoDateTime;
  company: CompanySummary;
  insolvency: InsolvencySection;
  charges: ChargesSection;
  officers: OfficersSection;
  psc: PscSection;
  filings: FilingsSection;
  warnings: BriefWarning[];
}

export interface BuildCompanyBriefInput {
  companyNumber: string;
  generatedAt: IsoDateTime;
  profile: ChCompanyProfile;
  officers: ChResult<ChOfficerList>;
  psc: ChResult<ChPscList>;
  exemptions?: ChResult<ChExemptions>;
  filings: ChResult<ChFilingHistoryList>;
  charges: ChResult<ChChargeList>;
  insolvency: ChResult<ChInsolvency>;
}

export interface BuildCompanyBriefResult {
  brief: CompanyBrief;
  warnings: BriefWarning[];
}

function asHttpStatus(status: number): number | undefined {
  return status > 0 ? status : undefined;
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function mapAddress(address: ChAddress | undefined): Address | undefined {
  if (!address) {
    return undefined;
  }

  const mapped: Address = {
    premises: clean(address.premises),
    addressLine1: clean(address.address_line_1),
    addressLine2: clean(address.address_line_2),
    locality: clean(address.locality),
    region: clean(address.region),
    postalCode: clean(address.postal_code),
    country: clean(address.country),
    careOf: clean(address.care_of),
    poBox: clean(address.po_box),
  };

  return Object.values(mapped).some((value) => value !== undefined)
    ? mapped
    : undefined;
}

function mapDateOfBirth(
  dateOfBirth: { month?: number; year?: number } | undefined,
): { month?: number; year?: number } | undefined {
  if (
    !dateOfBirth ||
    (dateOfBirth.month === undefined && dateOfBirth.year === undefined)
  ) {
    return undefined;
  }

  return {
    month: dateOfBirth.month,
    year: dateOfBirth.year,
  };
}

function mapOfficer(officer: ChOfficer): Officer {
  return {
    name: officer.name,
    role: officer.officer_role,
    appointedOn: officer.appointed_on,
    resignedOn: officer.resigned_on,
    nationality: officer.nationality,
    countryOfResidence: officer.country_of_residence,
    occupation: officer.occupation,
    dateOfBirth: mapDateOfBirth(officer.date_of_birth),
    identityVerificationFrom:
      officer.identity_verification_details?.appointment_verification_start_on,
    personNumber: officer.person_number,
    isPre1992Appointment: officer.is_pre_1992_appointment,
    address: mapAddress(officer.address),
  };
}

function isResigned(officer: ChOfficer): boolean {
  return officer.resigned_on !== undefined && officer.resigned_on !== null;
}

function natureLabel(code: string): string {
  const spaced = code.replace(/-/g, " ");
  return spaced === ""
    ? spaced
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function mapNameElements(
  nameElements: ChPsc["name_elements"],
): Psc["nameElements"] {
  if (!nameElements) {
    return undefined;
  }

  const mapped = {
    title: clean(nameElements.title),
    forename: clean(nameElements.forename),
    middleName: clean(nameElements.middle_name),
    surname: clean(nameElements.surname),
  };

  return Object.values(mapped).some((value) => value !== undefined)
    ? mapped
    : undefined;
}

function composePscName(
  nameElements: ChPsc["name_elements"],
): string | undefined {
  if (!nameElements) {
    return undefined;
  }

  const parts = [
    clean(nameElements.title),
    clean(nameElements.forename),
    clean(nameElements.middle_name),
    clean(nameElements.surname),
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function mapPsc(psc: ChPsc): Psc {
  return {
    name: clean(psc.name) ?? composePscName(psc.name_elements),
    nameElements: mapNameElements(psc.name_elements),
    naturesOfControl: (psc.natures_of_control ?? []).map((code) => ({
      code,
      label: natureLabel(code),
    })),
    ceased: psc.ceased,
    dateOfBirth: mapDateOfBirth(psc.date_of_birth),
    nationality: psc.nationality,
    countryOfResidence: psc.country_of_residence,
    address: mapAddress(psc.address),
  };
}

function mapExemptions(data: ChExemptions): PscExemption[] {
  const entries = data.exemptions;
  if (!entries) {
    return [];
  }

  return Object.entries(entries).map(([key, entry]) => ({
    key,
    exemptionType: entry.exemption_type,
    periods: (entry.items ?? []).map((period) => ({
      exemptFrom: period.exempt_from,
      exemptTo: period.exempt_to,
    })),
  }));
}

function exemptionsLink(
  psc: ChPscList,
  profile: ChCompanyProfile,
): string | undefined {
  return psc.links?.exemptions || profile.links?.exemptions || undefined;
}

function publicFilingUrl(self: string | undefined): string | undefined {
  if (!self || !self.startsWith("/")) {
    return undefined;
  }

  return `${CH_PUBLIC_BASE}${self}`;
}

function publicChargeFilingUrl(path: string | undefined): string | undefined {
  if (!path || !path.startsWith("/company/")) {
    return undefined;
  }

  return `${CH_PUBLIC_BASE}${path}`;
}

function mapFiling(filing: ChFilingHistoryItem): Filing {
  return {
    transactionId: filing.transaction_id,
    date: filing.date,
    type: filing.type,
    category: filing.category,
    description: filing.description,
    pages: filing.pages,
    paperFiled: filing.paper_filed,
    publicUrl: publicFilingUrl(filing.links?.self),
  };
}

function mapCharge(charge: ChCharge): Charge {
  return {
    chargeNumber: charge.charge_number,
    status: charge.status,
    classification: charge.classification
      ? {
          description: charge.classification.description,
          type: charge.classification.type,
        }
      : undefined,
    particulars: charge.particulars
      ? {
          description: charge.particulars.description,
          type: charge.particulars.type,
        }
      : undefined,
    createdOn: charge.created_on,
    deliveredOn: charge.delivered_on,
    satisfiedOn: charge.satisfied_on,
    personsEntitled: charge.persons_entitled?.map((person) => ({
      name: person.name,
    })),
    transactions: charge.transactions?.map((transaction) => ({
      filingType: transaction.filing_type,
      deliveredOn: transaction.delivered_on,
      publicFilingUrl: publicChargeFilingUrl(transaction.links?.filing),
    })),
  };
}

function mapInsolvencyCase(legalCase: ChInsolvencyCase): InsolvencyCase {
  return {
    type: legalCase.type,
    number: legalCase.number,
    dates: (legalCase.dates ?? []).map((date) => ({
      date: date.date,
      type: date.type,
    })),
    practitioners: (legalCase.practitioners ?? []).map((practitioner) => ({
      name: practitioner.name,
      role: practitioner.role,
      appointedOn: practitioner.appointed_on,
      ceasedToActOn: practitioner.ceased_to_act_on,
    })),
    notes: legalCase.notes,
  };
}

function buildCompanySummary(
  input: BuildCompanyBriefInput,
  warnings: BriefWarning[],
): CompanySummary {
  const profile = input.profile;

  if (profile.company_name === undefined) {
    warnings.push({
      section: "profile",
      code: "company_name_missing",
      message: "Profile did not include company_name.",
    });
  }

  if (profile.company_status === undefined) {
    warnings.push({
      section: "profile",
      code: "company_status_missing",
      message: "Profile did not include company_status.",
    });
  }

  return {
    number: input.companyNumber,
    name: profile.company_name,
    status: profile.company_status,
    statusDetail: profile.company_status_detail,
    type: profile.type,
    incorporatedOn: profile.date_of_creation,
    jurisdiction: profile.jurisdiction,
    sicCodes: profile.sic_codes ?? [],
    registeredOffice: mapAddress(profile.registered_office_address),
    canFile: profile.can_file,
    previousNames: (profile.previous_company_names ?? [])
      .map((previous) => ({
        name: previous.name,
        effectiveFrom: previous.effective_from,
        ceasedOn: previous.ceased_on,
      }))
      .filter(
        (previous) =>
          previous.name !== undefined ||
          previous.effectiveFrom !== undefined ||
          previous.ceasedOn !== undefined,
      ),
    flags: {
      accountsOverdue: profile.accounts?.overdue,
      confirmationStatementOverdue: profile.confirmation_statement?.overdue,
      hasBeenLiquidated: profile.has_been_liquidated,
      hasSuperSecurePscs: profile.has_super_secure_pscs,
      registeredOfficeInDispute: profile.registered_office_is_in_dispute,
      undeliverableRegisteredOffice:
        profile.undeliverable_registered_office_address,
    },
    publicUrl: `${CH_PUBLIC_BASE}/company/${encodeURIComponent(
      input.companyNumber,
    )}`,
  };
}

function buildOfficersSection(
  result: ChResult<ChOfficerList>,
  warnings: BriefWarning[],
): OfficersSection {
  if (!result.ok) {
    warnings.push({
      section: "officers",
      code: result.status === 404 ? "officers_not_found" : "officers_failed",
      message:
        result.status === 404
          ? "Officers endpoint returned 404; section unavailable."
          : `Officers request failed: ${result.error}`,
      httpStatus: asHttpStatus(result.status),
    });

    return {
      status: "unavailable",
      httpStatus: asHttpStatus(result.status),
      fetched: 0,
      active: [],
      recentResignations: [],
      truncated: false,
    };
  }

  const data = result.data;
  const items = Array.isArray(data.items) ? data.items : [];
  const fetched = items.length;
  const totalResults = data.total_results;

  const active = items
    .filter((officer) => !isResigned(officer))
    .map(mapOfficer);

  const recentResignations = items
    .filter(isResigned)
    .slice()
    .sort((a, b) => (b.resigned_on ?? "").localeCompare(a.resigned_on ?? ""))
    .slice(0, RECENT_RESIGNATIONS)
    .map(mapOfficer);

  if (totalResults === undefined) {
    warnings.push({
      section: "officers",
      code: "officers_total_missing",
      message: "Officers response did not include total_results.",
    });
  }

  return {
    status: items.length === 0 && (totalResults ?? 0) === 0 ? "none" : "ok",
    httpStatus: asHttpStatus(result.status),
    activeCount: data.active_count,
    resignedCount: data.resigned_count,
    inactiveCount: data.inactive_count,
    totalResults,
    fetched,
    active,
    recentResignations,
    truncated: totalResults !== undefined && fetched < totalResults,
  };
}

function buildPscSection(
  result: ChResult<ChPscList>,
  exemptions: ChResult<ChExemptions> | undefined,
  profile: ChCompanyProfile,
  warnings: BriefWarning[],
): PscSection {
  if (!result.ok) {
    warnings.push({
      section: "psc",
      code: result.status === 404 ? "psc_not_found" : "psc_failed",
      message:
        result.status === 404
          ? "PSC endpoint returned 404; section unavailable."
          : `PSC request failed: ${result.error}`,
      httpStatus: asHttpStatus(result.status),
    });

    return {
      status: "unavailable",
      httpStatus: asHttpStatus(result.status),
      fetched: 0,
      items: [],
      exemptions: [],
      truncated: false,
    };
  }

  const data = result.data;
  const items = Array.isArray(data.items) ? data.items : [];
  const fetched = items.length;
  const totalResults = data.total_results;
  const truncated = totalResults !== undefined && fetched < totalResults;

  if (totalResults === undefined) {
    warnings.push({
      section: "psc",
      code: "psc_total_missing",
      message: "PSC response did not include total_results.",
    });
  }

  if (items.length > 0) {
    return {
      status: "ok",
      httpStatus: asHttpStatus(result.status),
      activeCount: data.active_count,
      ceasedCount: data.ceased_count,
      totalResults,
      fetched,
      items: items.map(mapPsc),
      exemptions: [],
      truncated,
    };
  }

  const link = exemptionsLink(data, profile);

  if (!link) {
    return {
      status: "none",
      httpStatus: asHttpStatus(result.status),
      activeCount: data.active_count,
      ceasedCount: data.ceased_count,
      totalResults,
      fetched,
      items: [],
      exemptions: [],
      truncated,
      note: NO_PSC_NOTE,
    };
  }

  if (exemptions === undefined) {
    warnings.push({
      section: "exemptions",
      code: "exemptions_not_fetched",
      message:
        "PSC list returned no items and an exemptions link was present, but the exemptions lookup was not performed.",
    });

    return {
      status: "none",
      httpStatus: asHttpStatus(result.status),
      activeCount: data.active_count,
      ceasedCount: data.ceased_count,
      totalResults,
      fetched,
      items: [],
      exemptions: [],
      truncated,
      note: "PSC list returned no items; the exemptions lookup was not performed.",
    };
  }

  if (!exemptions.ok) {
    warnings.push({
      section: "exemptions",
      code: "exemptions_failed",
      message: `Exemptions request failed: ${exemptions.error}`,
      httpStatus: asHttpStatus(exemptions.status),
    });

    return {
      status: "none",
      httpStatus: asHttpStatus(result.status),
      activeCount: data.active_count,
      ceasedCount: data.ceased_count,
      totalResults,
      fetched,
      items: [],
      exemptions: [],
      truncated,
      note: "PSC list returned no items; the exemptions lookup failed.",
    };
  }

  return {
    status: "exempt",
    httpStatus: asHttpStatus(result.status),
    activeCount: data.active_count,
    ceasedCount: data.ceased_count,
    totalResults,
    fetched,
    items: [],
    exemptions: mapExemptions(exemptions.data),
    truncated,
  };
}

function buildFilingsSection(
  companyNumber: string,
  result: ChResult<ChFilingHistoryList>,
  warnings: BriefWarning[],
): FilingsSection {
  const publicHistoryUrl = `${CH_PUBLIC_BASE}/company/${encodeURIComponent(
    companyNumber,
  )}/filing-history`;

  if (!result.ok) {
    warnings.push({
      section: "filings",
      code: result.status === 404 ? "filings_not_found" : "filings_failed",
      message:
        result.status === 404
          ? "Filing history endpoint returned 404; section unavailable."
          : `Filing history request failed: ${result.error}`,
      httpStatus: asHttpStatus(result.status),
    });

    return {
      status: "unavailable",
      httpStatus: asHttpStatus(result.status),
      shown: 0,
      items: [],
      truncated: false,
      publicHistoryUrl,
    };
  }

  const data = result.data;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const sorted = rawItems
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const items = sorted.slice(0, FILINGS_SHOWN).map(mapFiling);
  const totalCount = data.total_count;
  const shown = items.length;
  const notShown =
    totalCount !== undefined ? Math.max(0, totalCount - shown) : undefined;

  if (totalCount === undefined) {
    warnings.push({
      section: "filings",
      code: "filings_total_missing",
      message: "Filing history response did not include total_count.",
    });
  }

  return {
    status: shown > 0 ? "ok" : "none",
    httpStatus: asHttpStatus(result.status),
    totalCount,
    shown,
    notShown,
    items,
    truncated: notShown !== undefined && notShown > 0,
    publicHistoryUrl,
  };
}

function buildChargesSection(
  result: ChResult<ChChargeList>,
  warnings: BriefWarning[],
): ChargesSection {
  if (!result.ok) {
    warnings.push({
      section: "charges",
      code: result.status === 404 ? "charges_not_found" : "charges_failed",
      message:
        result.status === 404
          ? "Charges endpoint returned 404; section unavailable."
          : `Charges request failed: ${result.error}`,
      httpStatus: asHttpStatus(result.status),
    });

    return {
      status: "unavailable",
      httpStatus: asHttpStatus(result.status),
      fetched: 0,
      items: [],
      outstanding: [],
      satisfied: [],
      satisfiedExamples: [],
      truncated: false,
    };
  }

  const data = result.data;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map(mapCharge);
  const fetched = items.length;
  const totalCount = data.total_count;
  const satisfied = items.filter(
    (charge) => charge.status === "fully-satisfied",
  );
  const outstanding = items.filter(
    (charge) => charge.status !== "fully-satisfied",
  );

  if (totalCount === undefined) {
    warnings.push({
      section: "charges",
      code: "charges_total_missing",
      message: "Charges response did not include total_count.",
    });
  }

  return {
    status: fetched > 0 ? "ok" : "none",
    httpStatus: asHttpStatus(result.status),
    totalCount,
    satisfiedCount: data.satisfied_count,
    partSatisfiedCount: data.part_satisfied_count,
    fetched,
    items,
    outstanding,
    satisfied,
    satisfiedExamples: satisfied.slice(0, SATISFIED_EXAMPLES),
    truncated: totalCount !== undefined && fetched < totalCount,
  };
}

function buildInsolvencySection(
  result: ChResult<ChInsolvency>,
  warnings: BriefWarning[],
): InsolvencySection {
  if (!result.ok) {
    if (result.status === 404) {
      return {
        status: "none",
        httpStatus: 404,
        cases: [],
      };
    }

    warnings.push({
      section: "insolvency",
      code: "insolvency_failed",
      message: `Insolvency request failed: ${result.error}`,
      httpStatus: asHttpStatus(result.status),
    });

    return {
      status: "unavailable",
      httpStatus: asHttpStatus(result.status),
      cases: [],
    };
  }

  const cases = (
    Array.isArray(result.data.cases) ? result.data.cases : []
  ).map(mapInsolvencyCase);

  return {
    status: cases.length > 0 ? "cases" : "none",
    httpStatus: asHttpStatus(result.status),
    insolvencyStatus: result.data.status,
    cases,
  };
}

export function exemptionsPath(
  psc: ChResult<ChPscList>,
  profile: ChCompanyProfile,
): string | undefined {
  if (!psc.ok) {
    return undefined;
  }

  const items = Array.isArray(psc.data.items) ? psc.data.items : [];
  if (items.length > 0) {
    return undefined;
  }

  return exemptionsLink(psc.data, profile);
}

export function buildCompanyBrief(
  input: BuildCompanyBriefInput,
): BuildCompanyBriefResult {
  const warnings: BriefWarning[] = [];

  const company = buildCompanySummary(input, warnings);
  const officers = buildOfficersSection(input.officers, warnings);
  const psc = buildPscSection(
    input.psc,
    input.exemptions,
    input.profile,
    warnings,
  );
  const filings = buildFilingsSection(
    input.companyNumber,
    input.filings,
    warnings,
  );
  const charges = buildChargesSection(input.charges, warnings);
  const insolvency = buildInsolvencySection(input.insolvency, warnings);

  const brief: CompanyBrief = {
    generatedAt: input.generatedAt,
    company,
    insolvency,
    charges,
    officers,
    psc,
    filings,
    warnings,
  };

  return { brief, warnings };
}
