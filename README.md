# CompanyBrief

CompanyBrief takes a UK company number, reads the Companies House public data API, and writes a diligence snapshot to a Notion page. It is a static page and two serverless functions on Vercel, with no framework, database, or login.

Live: https://ch-notion-diligence.vercel.app

## What it does

Enter a company number in the page. The app reads the company profile, officers, persons with significant control, charges, recent filings, and insolvency data from Companies House. When the PSC list is empty and Companies House supplies an exemptions link, it reads the exemption record instead.

It creates a new Notion page under the configured parent page. The page contains a snapshot callout and headline counts, then sections for:

- company details and previous names
- profile risk flags
- insolvency
- charges
- officers and recent resignations
- PSC entries or the exemption record
- recent filings
- sources and gaps

## How it works

1. The page calls `GET /api/diligence?number=<number>`.
2. `buildBrief` normalises the number and calls the company profile. A profile 404 returns company not found. A non-404 profile failure returns an upstream error.
3. After the profile succeeds, the app calls officers, PSC, filing history, charges, and insolvency in parallel. Each list fetches its first page once and then uses `paginate`, which advances by the number of items actually returned and stops at the section cap or the reported total.
4. If PSC items are empty and an exemptions link exists on the PSC response or the profile, the app calls the exemptions endpoint.
5. `buildCompanyBrief` normalises the raw responses into `CompanyBrief` and adds warnings for failed or partially paginated sections.
6. `buildPageContent` renders the brief into ordered Notion block sections.
7. `writeBrief` creates a title-only Notion page, then appends non-empty sections in order, up to 100 blocks per request. A failed section append becomes a warning and later sections still run.
8. `/api/brief` returns the brief, warnings, and trace. `/api/diligence` also writes the page and returns the Notion URL, id, combined warnings, and trace.

Companies House requests use Basic auth with the API key as the username and an empty password. Companies House and Notion requests use a 10 second timeout. Both clients retry 429 and 5xx up to 3 attempts, with `Retry-After` waits capped at 3 seconds.

### Upstream calls

| Service | Request | Use |
|---|---|---|
| Companies House | `GET /company/{number}` | Profile and flags |
| Companies House | `GET /company/{number}/officers` | Officers, page size 50 |
| Companies House | `GET /company/{number}/persons-with-significant-control` | PSC, page size 50 |
| Companies House | `GET /company/{number}/exemptions` | Only when PSC items are empty and an exemptions link exists |
| Companies House | `GET /company/{number}/filing-history` | Recent filings, 15 per run |
| Companies House | `GET /company/{number}/charges` | Charges, page size 50 |
| Companies House | `GET /company/{number}/insolvency` | Cases or none |
| Notion | `POST /v1/pages` | Create a page with the title only |
| Notion | `PATCH /v1/blocks/{page_id}/children` | Append sections, up to 100 blocks per request |

The PSC statements endpoint is not called. Notion requests send `Notion-Version: 2026-03-11`.

### Trace

Every response includes `trace`, an array of `{ section, status, ms }`. `buildBrief` records the profile call, each section task, and exemptions when it is fetched. `/api/diligence` appends `{ section: "notion", status: 200, ms }` around `writeBrief`. Parallel section entries can appear in completion order. The page shows the trace in a closed details table. Status 200 is green, 404 is amber, and every other value is red.

### File map

```text
api/brief.ts          GET /api/brief, JSON only
api/diligence.ts      GET /api/diligence, brief plus Notion write
lib/companiesHouse.ts Raw Companies House client, auth, retries, pagination
lib/companyBrief.ts   Raw responses to CompanyBrief
lib/buildBrief.ts     Profile gate, parallel sections, exemptions, trace
lib/blocks.ts         CompanyBrief to Notion blocks
lib/notion.ts         Create page and append blocks
public/index.html     Static page
scripts/probe.sh      Live API contract probe
vercel.json           Function duration
package.json          Scripts and dev dependencies
tsconfig.json         TypeScript settings
.env.example          Environment variable names
```

## Run locally

Node 24 is required. `package.json` declares `24.x`.

1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set these variables:

| Variable | Value |
|---|---|
| `CH_API_KEY` | Companies House API key |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_PARENT_PAGE_ID` | Parent page ID, not a URL |

4. Run `npm run dev`. This runs `npx vercel dev`. The Vercel CLI may ask you to link the directory to a project.
5. Open the URL printed by the CLI. The default is `http://localhost:3000`.

The Notion integration must have access to the parent page. Without that access, the create call fails and `/api/diligence` returns a Notion write error.

## Deploy

Import the repository into Vercel and set these Production environment variables:

- `CH_API_KEY`
- `NOTION_TOKEN`
- `NOTION_PARENT_PAGE_ID`

`vercel.json` sets the function duration to 60 seconds:

```json
{
  "functions": {
    "api/*.ts": {
      "maxDuration": 60
    }
  }
}
```

A run makes the Companies House reads, one title-only Notion create, and sequential section appends. In testing, the Notion appends took about 5 seconds, so 60 seconds leaves headroom for slower runs.

## API

Both routes are GET only. A non-GET request returns 405 with `{ "error": "Method not allowed" }`.

### `GET /api/brief?number=`

Returns the brief without writing to Notion.

`number` is required. The app trims it, removes internal whitespace, and uppercases it. A value of 1 to 8 digits is left-padded to 8 characters. Any 8-character value matching `[A-Z0-9]{8}` is accepted.

Success shape:

```ts
{
  brief: CompanyBrief;
  warnings: BriefWarning[];
  trace: TraceEntry[];
}
```

`warnings` is the same array as `brief.warnings`. The full `CompanyBrief` and `BriefWarning` shapes are in `lib/companyBrief.ts`.

### `GET /api/diligence?number=`

Builds the brief, creates the Notion page, and appends the sections. It uses the same `number` rules and the same build failures as `/api/brief`.

Success shape:

```ts
{
  url: string;
  id: string;
  warnings: PublishWarning[];
  trace: TraceEntry[];
}
```

`url` and `id` come from the Notion create response. `warnings` combines brief warnings and Notion append warnings. Both are mapped to:

```ts
{
  section: string;
  code: string;
  message: string;
  httpStatus?: number;
}
```

`TraceEntry` is:

```ts
{
  section: string;
  status: number;
  ms: number;
}
```

A failed section append does not fail the response. It adds a warning and later sections still run. A failed page create returns 502.

### Errors

| Status | Condition | Body |
|---|---|---|
| 400 | Invalid company number | `{ "error": "Enter a valid company number" }` |
| 404 | Company profile returned 404 | `{ "error": "Company not found" }` |
| 405 | Method is not GET | `{ "error": "Method not allowed" }` |
| 500 | Unexpected server error | `{ "error": "Internal server error" }` |
| 502 | Profile request failed with a non-404 status | `{ "error": "Companies House unavailable", "status": <upstream status> }` |
| 502 | Notion create failed on `/api/diligence` | `{ "error": "Notion write failed", "status": <upstream status> }` |

A section-level 404 for officers, PSC, filings, or charges is not a route failure. Those sections become unavailable with a warning, and the route still returns 200. Insolvency 404 means no insolvency history and does not produce a warning.

## Verified upstream behaviour

The live probe is `scripts/probe.sh`. It prints raw bodies and PASS/FAIL per check. It creates up to two temporary Notion pages under the parent and trashes them by default. It reads the same three environment variables as the app.

- Companies House uses Basic auth: the API key is the username and the password is empty.
- A PSC list with no entries returns 200 with `items: []`. Charges with no entries return 200 with `items: []` and `total_count: 0`. Neither is a 404.
- Insolvency returns 404 when there is no history. The app treats that as `none`, not an error.
- Exemptions are at `/company/{number}/exemptions`. The PSC statements endpoint returned 404 with an empty body and is not used.
- `has_charges` is not trusted. It was false on 00445790, which has 9 charges and 2 outstanding.
- Officer fields vary by role. Secretaries and directors expose different optional fields, so the normaliser treats those fields as optional.
- Charges paginate. `classification` and `particulars` are objects, and `transactions[].links` is an object.
- Filing `total_count` can be in the thousands. 00445790 returned 8,373.

## Limits and deliberate cuts

- Officers: up to 200 fetched. The page shows at most 50 active officers and the 5 most recent resignations.
- PSC: up to 100 fetched. The page renders every fetched PSC item. The planned 50 item display cap is not implemented.
- Charges: up to 100 fetched. The page shows at most 50 outstanding or other charges and at most 5 satisfied examples.
- Filings: 15 fetched and shown.
- No document contents. Filing links go to the public filing page.
- No accounts figures. The profile exposes an accounts overdue flag, not figures.
- No full filing history.
- One page per run. There is no find-or-create. Each run creates a new page with the generation time in the title.
- No application cache. The page requests `/api/diligence` with `cache: "no-store"`.
- No per-user rate limit or authentication. The demo URL uses shared server-side credentials.
- Notion version is pinned to `2026-03-11`.

## What I would harden for a real client

1. Add authentication and per-user quotas or rate limits to the publish route, and replace the shared Notion token with a per-client connection where possible.
2. Add idempotent, versioned Notion writes keyed by company number, with a refresh policy, instead of creating a new page on every run.
3. Persist write state and retry failed section appends so a partial Notion page can be completed or repaired.
4. Raise or remove the fetch caps and paginate officers, PSC, and charges fully. Add an explicit outstanding-only charge view and confirm corporate PSC shapes.

## Attribution

Contains public sector information licensed under the Open Government Licence v3.0.

This is a snapshot, not advice.
