import type {
  Address,
  BriefSection,
  BriefWarning,
  Charge,
  CompanyBrief,
  CompanyFlags,
  Filing,
  InsolvencyCase,
  Officer,
  PreviousName,
  Psc,
  PscExemption,
} from "./companyBrief";

export interface NotionTextLink {
  url: string;
}

export interface NotionTextContent {
  content: string;
  link?: NotionTextLink | null;
}

export interface NotionRichText {
  type: "text";
  text: NotionTextContent;
}

export type NotionCalloutColor =
  | "red_background"
  | "yellow_background"
  | "gray_background";

export interface NotionCalloutBlock {
  object: "block";
  type: "callout";
  callout: {
    rich_text: NotionRichText[];
    color: NotionCalloutColor;
  };
}

export interface NotionParagraphBlock {
  object: "block";
  type: "paragraph";
  paragraph: {
    rich_text: NotionRichText[];
  };
}

export interface NotionHeading1Block {
  object: "block";
  type: "heading_1";
  heading_1: {
    rich_text: NotionRichText[];
  };
}

export interface NotionHeading2Block {
  object: "block";
  type: "heading_2";
  heading_2: {
    rich_text: NotionRichText[];
  };
}

export interface NotionBulletedListItemBlock {
  object: "block";
  type: "bulleted_list_item";
  bulleted_list_item: {
    rich_text: NotionRichText[];
  };
}

export interface NotionDividerBlock {
  object: "block";
  type: "divider";
  divider: Record<string, never>;
}

export type NotionBlock =
  | NotionCalloutBlock
  | NotionParagraphBlock
  | NotionHeading1Block
  | NotionHeading2Block
  | NotionBulletedListItemBlock
  | NotionDividerBlock;

export interface PageSection {
  key: string;
  blocks: NotionBlock[];
}

export interface PageContent {
  title: string;
  sections: PageSection[];
}

const MAX_TEXT_LENGTH = 2000;

function truncateContent(content: string): string {
  const characters = Array.from(content);
  return characters.length <= MAX_TEXT_LENGTH
    ? content
    : characters.slice(0, MAX_TEXT_LENGTH).join("");
}

function richText(content: string): NotionRichText {
  return {
    type: "text",
    text: {
      content: truncateContent(content),
    },
  };
}

function richTextWithLink(content: string, url: string): NotionRichText {
  return {
    type: "text",
    text: {
      content: truncateContent(content),
      link: { url },
    },
  };
}

function paragraph(
  content: string | NotionRichText[],
): NotionParagraphBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: typeof content === "string" ? [richText(content)] : content,
    },
  };
}

function heading1(content: string): NotionHeading1Block {
  return {
    object: "block",
    type: "heading_1",
    heading_1: {
      rich_text: [richText(content)],
    },
  };
}

function heading2(content: string): NotionHeading2Block {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [richText(content)],
    },
  };
}

function bullet(
  content: string | NotionRichText[],
): NotionBulletedListItemBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: typeof content === "string" ? [richText(content)] : content,
    },
  };
}

function callout(
  content: string,
  color: NotionCalloutColor,
): NotionCalloutBlock {
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: [richText(content)],
      color,
    },
  };
}

function divider(): NotionDividerBlock {
  return {
    object: "block",
    type: "divider",
    divider: {},
  };
}

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .filter(
      (part): part is string => part !== undefined && part.trim() !== "",
    )
    .join(", ");
}

function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatUtcMinute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatMonthYear(
  value: { month?: number; year?: number } | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const month =
    value.month !== undefined ? String(value.month).padStart(2, "0") : undefined;
  const year = value.year !== undefined ? String(value.year) : undefined;

  if (month !== undefined && year !== undefined) {
    return `${month}/${year}`;
  }

  return month ?? year;
}

function formatPages(pages: number | undefined): string | undefined {
  if (pages === undefined) {
    return undefined;
  }

  return `${formatCount(pages)} ${pages === 1 ? "page" : "pages"}`;
}

function formatAddress(address: Address | undefined): string | undefined {
  if (!address) {
    return undefined;
  }

  const careOf = address.careOf ? `c/o ${address.careOf}` : undefined;
  const formatted = joinParts([
    careOf,
    address.premises,
    address.addressLine1,
    address.addressLine2,
    address.locality,
    address.region,
    address.postalCode,
    address.country,
  ]);

  return formatted === "" ? undefined : formatted;
}

function displayName(brief: CompanyBrief): string {
  return brief.company.name?.trim() || brief.company.number;
}

function warningText(
  brief: CompanyBrief,
  sections: BriefSection[],
): string | undefined {
  const warning = brief.warnings.find((item) =>
    sections.includes(item.section),
  );

  if (!warning) {
    return undefined;
  }

  const status =
    warning.httpStatus !== undefined ? ` (HTTP ${warning.httpStatus})` : "";
  return `${warning.message}${status}`;
}

function formatWarning(warning: BriefWarning): string {
  const status =
    warning.httpStatus !== undefined ? ` (HTTP ${warning.httpStatus})` : "";
  return `[${warning.section}] ${warning.code}: ${warning.message}${status}`;
}

function riskFlagLabels(flags: CompanyFlags): string[] {
  const labels: string[] = [];

  if (flags.accountsOverdue === true) {
    labels.push("Accounts overdue");
  }
  if (flags.confirmationStatementOverdue === true) {
    labels.push("Confirmation statement overdue");
  }
  if (flags.hasBeenLiquidated === true) {
    labels.push("Profile records liquidation history");
  }
  if (flags.hasSuperSecurePscs === true) {
    labels.push("Super-secure PSC regime");
  }
  if (flags.registeredOfficeInDispute === true) {
    labels.push("Registered office in dispute");
  }
  if (flags.undeliverableRegisteredOffice === true) {
    labels.push("Undeliverable registered office");
  }

  return labels;
}

function calloutColor(brief: CompanyBrief): NotionCalloutColor {
  const flags = brief.company.flags;
  const red =
    (brief.company.status !== undefined &&
      brief.company.status !== "active") ||
    brief.insolvency.status === "cases" ||
    flags.accountsOverdue === true ||
    flags.confirmationStatementOverdue === true ||
    flags.hasBeenLiquidated === true;

  if (red) {
    return "red_background";
  }

  const truncated =
    brief.officers.truncated ||
    brief.psc.truncated ||
    brief.filings.truncated ||
    brief.charges.truncated;

  if (brief.warnings.length > 0 || truncated) {
    return "yellow_background";
  }

  return "gray_background";
}

function calloutText(brief: CompanyBrief): string {
  const status = brief.company.status ?? "status not returned";
  return `Diligence snapshot: ${displayName(brief)} (${brief.company.number}), ${status}. Generated ${formatUtcMinute(brief.generatedAt)} UTC.`;
}

function headlineCounts(brief: CompanyBrief): string {
  let charges: string;

  if (brief.charges.status === "unavailable") {
    charges = "Charges: unavailable.";
  } else if (brief.charges.status === "none") {
    charges = "Charges: none returned.";
  } else {
    const total =
      brief.charges.totalCount !== undefined
        ? `${formatCount(brief.charges.totalCount)} total`
        : `${formatCount(brief.charges.fetched)} fetched`;
    charges = `Charges: ${total}, ${formatCount(brief.charges.outstanding.length)} outstanding/other, ${formatCount(brief.charges.satisfiedCount ?? brief.charges.satisfied.length)} satisfied.`;
  }

  let officers: string;

  if (brief.officers.status === "unavailable") {
    officers = "Officers: unavailable.";
  } else if (brief.officers.status === "none") {
    officers = "Officers: none returned.";
  } else {
    const parts = [
      `${formatCount(brief.officers.activeCount ?? brief.officers.active.length)} active`,
      `${formatCount(brief.officers.resignedCount ?? 0)} resigned`,
    ];

    if (brief.officers.inactiveCount !== undefined) {
      parts.push(`${formatCount(brief.officers.inactiveCount)} inactive`);
    }

    officers = `Officers: ${parts.join(", ")}.`;
  }

  let filings: string;

  if (brief.filings.status === "unavailable") {
    filings = "Filings: unavailable.";
  } else if (brief.filings.status === "none") {
    filings = "Filings: none returned.";
  } else if (brief.filings.totalCount !== undefined) {
    filings = `Filings: ${formatCount(brief.filings.totalCount)} total, ${formatCount(brief.filings.shown)} shown.`;
  } else {
    filings = `Filings: ${formatCount(brief.filings.shown)} shown.`;
  }

  let psc: string;

  if (brief.psc.status === "unavailable") {
    psc = "PSC: unavailable.";
  } else if (brief.psc.status === "none") {
    psc = "PSC: none returned.";
  } else if (brief.psc.status === "exempt") {
    psc = "PSC: exempt.";
  } else {
    const active =
      brief.psc.activeCount ??
      brief.psc.items.filter((item) => item.ceased !== true).length;
    const ceased =
      brief.psc.ceasedCount ??
      brief.psc.items.filter((item) => item.ceased === true).length;
    psc = `PSC: ${formatCount(active)} active, ${formatCount(ceased)} ceased.`;
  }

  return [charges, officers, filings, psc].join(" ");
}

function companyBlocks(brief: CompanyBrief): NotionBlock[] {
  const blocks: NotionBlock[] = [heading1("Company")];

  if (brief.company.name) {
    blocks.push(bullet(`Legal name: ${brief.company.name}`));
  }

  blocks.push(bullet(`Company number: ${brief.company.number}`));

  if (brief.company.status) {
    const detail = brief.company.statusDetail
      ? `, ${brief.company.statusDetail}`
      : "";
    blocks.push(bullet(`Status: ${brief.company.status}${detail}`));
  }

  if (brief.company.type) {
    blocks.push(bullet(`Type: ${brief.company.type}`));
  }

  if (brief.company.incorporatedOn) {
    blocks.push(bullet(`Incorporated: ${brief.company.incorporatedOn}`));
  }

  if (brief.company.jurisdiction) {
    blocks.push(bullet(`Jurisdiction: ${brief.company.jurisdiction}`));
  }

  if (brief.company.sicCodes.length > 0) {
    blocks.push(bullet(`SIC codes: ${brief.company.sicCodes.join(", ")}`));
  }

  const address = formatAddress(brief.company.registeredOffice);

  if (address) {
    blocks.push(bullet(`Registered office: ${address}`));
  }

  if (brief.company.canFile !== undefined) {
    blocks.push(bullet(`Can file: ${brief.company.canFile ? "yes" : "no"}`));
  }

  return blocks;
}

function previousNameSummary(previous: PreviousName): string {
  return joinParts([
    previous.name,
    previous.effectiveFrom
      ? `effective from ${previous.effectiveFrom}`
      : undefined,
    previous.ceasedOn ? `ceased ${previous.ceasedOn}` : undefined,
  ]);
}

function officerSummary(officer: Officer): string {
  const dateOfBirth = formatMonthYear(officer.dateOfBirth);
  const address = formatAddress(officer.address);

  return joinParts([
    officer.name,
    officer.role,
    officer.appointedOn ? `appointed ${officer.appointedOn}` : undefined,
    officer.resignedOn ? `resigned ${officer.resignedOn}` : undefined,
    officer.nationality ? `nationality ${officer.nationality}` : undefined,
    officer.countryOfResidence
      ? `country ${officer.countryOfResidence}`
      : undefined,
    dateOfBirth ? `DOB ${dateOfBirth}` : undefined,
    officer.identityVerificationFrom
      ? `appointment verification from ${officer.identityVerificationFrom}`
      : undefined,
    address ? `address ${address}` : undefined,
  ]);
}

function chargeSummary(charge: Charge): string {
  const classification =
    charge.classification?.description ?? charge.classification?.type;
  const chargeNumber =
    charge.chargeNumber !== undefined ? `#${charge.chargeNumber}` : undefined;
  const persons = charge.personsEntitled
    ?.map((person) => person.name)
    .filter((name): name is string => name !== undefined && name.trim() !== "")
    .join("; ");

  return joinParts([
    classification ?? "Charge",
    chargeNumber,
    charge.status,
    charge.createdOn ? `created ${charge.createdOn}` : undefined,
    charge.deliveredOn ? `delivered ${charge.deliveredOn}` : undefined,
    charge.satisfiedOn ? `satisfied ${charge.satisfiedOn}` : undefined,
    persons ? `persons entitled: ${persons}` : undefined,
  ]);
}

function chargesSummary(brief: CompanyBrief): string {
  const section = brief.charges;
  const parts = [
    section.totalCount !== undefined
      ? `${formatCount(section.totalCount)} registered`
      : `${formatCount(section.fetched)} fetched`,
    `${formatCount(section.satisfiedCount ?? section.satisfied.length)} fully satisfied`,
  ];

  if (section.partSatisfiedCount !== undefined) {
    parts.push(`${formatCount(section.partSatisfiedCount)} part satisfied`);
  }

  parts.push(
    section.truncated
      ? `${formatCount(section.outstanding.length)} outstanding/other in fetched data`
      : `${formatCount(section.outstanding.length)} outstanding/other`,
  );

  if (section.truncated && section.totalCount !== undefined) {
    parts.push(
      `${formatCount(Math.max(0, section.totalCount - section.fetched))} not shown`,
    );
  }

  return `${parts.join(", ")}.`;
}

function filingItemBlocks(filing: Filing): NotionBlock[] {
  const pages = formatPages(filing.pages);
  const typeAndCategory = joinParts([filing.type, filing.category]);
  const base = joinParts([
    filing.date,
    filing.description,
    typeAndCategory === "" ? undefined : typeAndCategory,
    pages,
  ]);

  if (filing.publicUrl) {
    const content: NotionRichText[] = [];

    if (base) {
      content.push(richText(`${base}, `));
    }

    content.push(richTextWithLink("view", filing.publicUrl));
    return [bullet(content)];
  }

  return base ? [bullet(base)] : [];
}

function insolvencyCaseSummary(legalCase: InsolvencyCase): string {
  const dates = legalCase.dates
    .map((date) => joinParts([date.type, date.date]))
    .filter((date) => date !== "")
    .join("; ");

  const practitioners = legalCase.practitioners
    .map((practitioner) => {
      const role = practitioner.role ? `, ${practitioner.role}` : "";
      const appointed = practitioner.appointedOn
        ? `, appointed ${practitioner.appointedOn}`
        : "";
      return `${practitioner.name ?? "Practitioner"}${role}${appointed}`;
    })
    .join("; ");

  const notes = legalCase.notes?.join("; ");

  return joinParts([
    legalCase.type ?? "Insolvency case",
    legalCase.number ? `case ${legalCase.number}` : undefined,
    dates ? `dates: ${dates}` : undefined,
    practitioners ? `practitioners: ${practitioners}` : undefined,
    notes ? `notes: ${notes}` : undefined,
  ]);
}

function exemptionLabel(exemption: PscExemption): string {
  const raw = (exemption.exemptionType ?? exemption.key)
    .replace(/[_-]+/g, " ")
    .trim();

  if (raw === "") {
    return "Exemption";
  }

  const withAcronyms = raw
    .replace(/\bpsc\b/gi, "PSC")
    .replace(/\buk\b/gi, "UK");

  return withAcronyms.charAt(0).toUpperCase() + withAcronyms.slice(1);
}

function pscSummary(psc: Psc): string {
  const natures =
    psc.naturesOfControl.length > 0
      ? psc.naturesOfControl
          .map((nature) => `${nature.label} (${nature.code})`)
          .join("; ")
      : undefined;
  const dateOfBirth = formatMonthYear(psc.dateOfBirth);
  const address = formatAddress(psc.address);

  return joinParts([
    psc.name,
    natures ? `natures: ${natures}` : undefined,
    psc.ceased === true ? "ceased" : undefined,
    psc.nationality ? `nationality ${psc.nationality}` : undefined,
    psc.countryOfResidence
      ? `country ${psc.countryOfResidence}`
      : undefined,
    dateOfBirth ? `DOB ${dateOfBirth}` : undefined,
    address ? `address ${address}` : undefined,
  ]);
}

function truncationNotes(brief: CompanyBrief): string[] {
  const notes: string[] = [];

  if (brief.charges.truncated && brief.charges.totalCount !== undefined) {
    notes.push(
      `Charges: fetched ${formatCount(brief.charges.fetched)} of ${formatCount(brief.charges.totalCount)}; ${formatCount(Math.max(0, brief.charges.totalCount - brief.charges.fetched))} not shown.`,
    );
  }

  if (brief.officers.truncated && brief.officers.totalResults !== undefined) {
    notes.push(
      `Officers: fetched ${formatCount(brief.officers.fetched)} of ${formatCount(brief.officers.totalResults)}; ${formatCount(Math.max(0, brief.officers.totalResults - brief.officers.fetched))} not shown.`,
    );
  }

  if (brief.psc.truncated && brief.psc.totalResults !== undefined) {
    notes.push(
      `PSC: fetched ${formatCount(brief.psc.fetched)} of ${formatCount(brief.psc.totalResults)}; ${formatCount(Math.max(0, brief.psc.totalResults - brief.psc.fetched))} not shown.`,
    );
  }

  if (brief.filings.truncated && brief.filings.totalCount !== undefined) {
    notes.push(
      `Filings: showing ${formatCount(brief.filings.shown)} of ${formatCount(brief.filings.totalCount)}; ${formatCount(brief.filings.notShown ?? 0)} not shown.`,
    );
  }

  return notes;
}

function insolvencyBlocks(brief: CompanyBrief): NotionBlock[] {
  const blocks: NotionBlock[] = [heading1("Insolvency")];

  if (brief.insolvency.status === "unavailable") {
    const why = warningText(brief, ["insolvency"]);
    blocks.push(
      paragraph(
        why
          ? `Insolvency data unavailable. ${why}`
          : "Insolvency data unavailable.",
      ),
    );
    return blocks;
  }

  if (brief.insolvency.status === "cases") {
    blocks.push(callout("Insolvency cases present.", "red_background"));

    for (const legalCase of brief.insolvency.cases) {
      const summary = insolvencyCaseSummary(legalCase);
      if (summary) {
        blocks.push(bullet(summary));
      }
    }

    return blocks;
  }

  const suffix =
    brief.insolvency.httpStatus === 404 ? " (HTTP 404)" : "";
  blocks.push(paragraph(`No insolvency cases returned${suffix}.`));

  if (brief.insolvency.insolvencyStatus) {
    blocks.push(
      bullet(`Insolvency status: ${brief.insolvency.insolvencyStatus}`),
    );
  }

  return blocks;
}

function chargeBlocks(brief: CompanyBrief): NotionBlock[] {
  if (brief.charges.status === "unavailable") {
    const why = warningText(brief, ["charges"]);
    return [
      heading1("Charges"),
      paragraph(
        why ? `Charges data unavailable. ${why}` : "Charges data unavailable.",
      ),
    ];
  }

  if (brief.charges.status !== "ok") {
    return [];
  }

  const blocks: NotionBlock[] = [
    heading1("Charges"),
    paragraph(chargesSummary(brief)),
  ];

  if (brief.charges.outstanding.length > 0) {
    blocks.push(heading2("Outstanding/other"));

    for (const charge of brief.charges.outstanding.slice(0, 50)) {
      const summary = chargeSummary(charge);
      if (summary) {
        blocks.push(bullet(summary));
      }
    }

    if (brief.charges.outstanding.length > 50) {
      blocks.push(
        paragraph(
          `Showing 50 of ${formatCount(brief.charges.outstanding.length)} outstanding/other charges.`,
        ),
      );
    }
  }

  const satisfiedTotal =
    brief.charges.satisfiedCount ?? brief.charges.satisfied.length;

  if (satisfiedTotal > 0) {
    blocks.push(heading2("Satisfied"));
    blocks.push(paragraph(`${formatCount(satisfiedTotal)} fully satisfied.`));

    for (const charge of brief.charges.satisfiedExamples.slice(0, 5)) {
      const summary = chargeSummary(charge);
      if (summary) {
        blocks.push(bullet(summary));
      }
    }

    if (satisfiedTotal > brief.charges.satisfiedExamples.length) {
      blocks.push(
        paragraph(
          `Showing ${formatCount(brief.charges.satisfiedExamples.length)} of ${formatCount(satisfiedTotal)} satisfied charges.`,
        ),
      );
    }
  }

  return blocks;
}

function officerBlocks(brief: CompanyBrief): NotionBlock[] {
  if (brief.officers.status === "unavailable") {
    const why = warningText(brief, ["officers"]);
    return [
      heading1("Officers"),
      paragraph(
        why
          ? `Officers data unavailable. ${why}`
          : "Officers data unavailable.",
      ),
    ];
  }

  if (brief.officers.status !== "ok") {
    return [];
  }

  const parts = [
    `${formatCount(brief.officers.activeCount ?? brief.officers.active.length)} active`,
    `${formatCount(brief.officers.resignedCount ?? 0)} resigned`,
  ];

  if (brief.officers.inactiveCount !== undefined) {
    parts.push(`${formatCount(brief.officers.inactiveCount)} inactive`);
  }

  if (brief.officers.totalResults !== undefined) {
    parts.push(`${formatCount(brief.officers.totalResults)} total`);
  }

  const blocks: NotionBlock[] = [
    heading1("Officers"),
    paragraph(`${parts.join(", ")}.`),
  ];

  if (brief.officers.active.length > 0) {
    blocks.push(heading2("Active officers"));

    for (const officer of brief.officers.active.slice(0, 50)) {
      const summary = officerSummary(officer);
      if (summary) {
        blocks.push(bullet(summary));
      }
    }

    if (brief.officers.active.length > 50) {
      blocks.push(
        paragraph(
          `Showing 50 of ${formatCount(brief.officers.active.length)} active officers.`,
        ),
      );
    }
  }

  if (brief.officers.recentResignations.length > 0) {
    blocks.push(heading2("Recent resignations"));

    for (const officer of brief.officers.recentResignations.slice(0, 5)) {
      const summary = officerSummary(officer);
      if (summary) {
        blocks.push(bullet(summary));
      }
    }
  }

  return blocks;
}

function pscBlocks(brief: CompanyBrief): NotionBlock[] {
  const blocks: NotionBlock[] = [heading1("PSC")];

  if (brief.psc.status === "unavailable") {
    const why = warningText(brief, ["psc", "exemptions"]);
    blocks.push(
      paragraph(
        why ? `PSC data unavailable. ${why}` : "PSC data unavailable.",
      ),
    );
    return blocks;
  }

  if (brief.psc.status === "none") {
    blocks.push(paragraph(brief.psc.note ?? "No PSC items returned."));
    return blocks;
  }

  if (brief.psc.status === "exempt") {
    blocks.push(callout("PSC exempt.", "gray_background"));
    let periods = 0;

    for (const exemption of brief.psc.exemptions) {
      for (const period of exemption.periods) {
        const summary = joinParts([
          exemptionLabel(exemption),
          period.exemptFrom ? `from ${period.exemptFrom}` : undefined,
          period.exemptTo ? `to ${period.exemptTo}` : undefined,
        ]);

        if (summary) {
          blocks.push(bullet(summary));
        }

        periods += 1;
      }
    }

    if (periods === 0) {
      blocks.push(paragraph("No exemption periods returned."));
    }

    return blocks;
  }

  const active =
    brief.psc.activeCount ??
    brief.psc.items.filter((item) => item.ceased !== true).length;
  const ceased =
    brief.psc.ceasedCount ??
    brief.psc.items.filter((item) => item.ceased === true).length;

  blocks.push(
    paragraph(
      `${formatCount(active)} active, ${formatCount(ceased)} ceased.`,
    ),
  );

  for (const psc of brief.psc.items) {
    const summary = pscSummary(psc);
    if (summary) {
      blocks.push(bullet(summary));
    }
  }

  return blocks;
}

function filingBlocks(brief: CompanyBrief): NotionBlock[] {
  if (brief.filings.status === "unavailable") {
    const why = warningText(brief, ["filings"]);
    return [
      heading1("Recent filings"),
      paragraph(
        why
          ? `Filing history unavailable. ${why}`
          : "Filing history unavailable.",
      ),
    ];
  }

  if (brief.filings.status !== "ok") {
    return [];
  }

  const blocks: NotionBlock[] = [heading1("Recent filings")];

  if (brief.filings.totalCount !== undefined) {
    blocks.push(
      paragraph(
        `Showing ${formatCount(brief.filings.shown)} of ${formatCount(brief.filings.totalCount)}; ${formatCount(brief.filings.notShown ?? 0)} not shown.`,
      ),
    );
  } else {
    blocks.push(
      paragraph(
        `Showing ${formatCount(brief.filings.shown)}; total count not returned.`,
      ),
    );
  }

  for (const filing of brief.filings.items) {
    blocks.push(...filingItemBlocks(filing));
  }

  return blocks;
}

function sourceBlocks(brief: CompanyBrief): NotionBlock[] {
  const blocks: NotionBlock[] = [
    heading1("Sources and gaps"),
    paragraph(`Generated ${formatUtcMinute(brief.generatedAt)} UTC.`),
  ];

  if (brief.warnings.length === 0) {
    blocks.push(bullet("No warnings."));
  } else {
    for (const warning of brief.warnings) {
      blocks.push(bullet(formatWarning(warning)));
    }
  }

  const notes = truncationNotes(brief);

  if (notes.length === 0) {
    blocks.push(bullet("No truncation."));
  } else {
    for (const note of notes) {
      blocks.push(bullet(note));
    }
  }

  blocks.push(
    bullet(
      "Not included: full filing history, document contents, accounts figures, officer appointments elsewhere, has_charges/has_insolvency_history, PSC statements endpoint.",
    ),
  );
  blocks.push(
    bullet("PSC natures rendered from Companies House codes."),
  );
  blocks.push(paragraph("Snapshot, not advice."));

  return blocks;
}

export function buildPageContent(brief: CompanyBrief): PageContent {
  const name = displayName(brief);
  const title = truncateContent(
    `Diligence: ${name} (${brief.company.number}) ${formatUtcMinute(brief.generatedAt)} UTC`,
  );
  const sections: PageSection[] = [];

  sections.push({
    key: "headline",
    blocks: [
      callout(calloutText(brief), calloutColor(brief)),
      paragraph(headlineCounts(brief)),
    ],
  });

  sections.push({
    key: "company",
    blocks: companyBlocks(brief),
  });

  sections.push({
    key: "profile_link",
    blocks: [
      paragraph([
        richTextWithLink("Companies House profile", brief.company.publicUrl),
      ]),
    ],
  });

  const previousNameBlocks = brief.company.previousNames
    .map(previousNameSummary)
    .filter((summary) => summary !== "")
    .map((summary) => bullet(summary));

  if (previousNameBlocks.length > 0) {
    sections.push({
      key: "previous_names",
      blocks: [heading2("Previous names"), ...previousNameBlocks],
    });
  }

  const riskLabels = riskFlagLabels(brief.company.flags);

  if (riskLabels.length > 0) {
    sections.push({
      key: "risk_flags",
      blocks: [
        heading2("Risk flags"),
        ...riskLabels.map((label) => bullet(label)),
      ],
    });
  }

  sections.push({
    key: "insolvency",
    blocks: insolvencyBlocks(brief),
  });

  const charges = chargeBlocks(brief);

  if (charges.length > 0) {
    sections.push({
      key: "charges",
      blocks: charges,
    });
  }

  const officers = officerBlocks(brief);

  if (officers.length > 0) {
    sections.push({
      key: "officers",
      blocks: officers,
    });
  }

  sections.push({
    key: "psc",
    blocks: pscBlocks(brief),
  });

  const filings = filingBlocks(brief);

  if (filings.length > 0) {
    sections.push({
      key: "filings",
      blocks: filings,
    });
  }

  sections.push({
    key: "sources_gaps",
    blocks: sourceBlocks(brief),
  });

  return { title, sections };
}
