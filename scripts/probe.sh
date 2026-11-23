#!/usr/bin/env bash
# ch-notion-probe.sh
#
# Live probe of Companies House + Notion before any app code is written.
# Prints raw response bodies and PASS/FAIL per check.
#
# Requires: bash, curl, node. No jq.
#
# Setup:
#   export CH_API_KEY='...'
#   export NOTION_TOKEN='...'
#   export NOTION_PARENT_PAGE_ID='...'   # page ID, not the full URL
#   bash ch-notion-probe.sh
#
# The Notion integration must have access to the parent page. Check 1 needs
# insert permission to test POST /v1/pages. If insert is denied, the script
# also runs a read-only GET with the same version header so you can tell a
# permission failure from a version rejection.
#
# Check 1 creates up to two pages under the parent, titled "DELETE ME ...".
# CLEANUP=1 (default) tries to trash them at the end. CLEANUP=0 keeps them.
# Any page the cleanup cannot trash is printed with its ID.
#
# Company defaults were checked on the public register on 2026-11-23:
#   TESCO PLC          00445790  PSC-exempt, 9 charges, many filings/officers
#   ANTHROPIC LIMITED  14604577  active, 0 charges
# Override any of them with the env vars below.

set -u
set -o pipefail

CH_BASE="https://api.company-information.service.gov.uk"
NOTION_BASE="https://api.notion.com/v1"
NOTION_VERSION_NEW="2026-03-11"
NOTION_VERSION_FALLBACK="2022-06-28"

NO_PSC_COMPANY="${NO_PSC_COMPANY:-00445790}"
NO_CHARGES_COMPANY="${NO_CHARGES_COMPANY:-14604577}"
NO_INSOLVENCY_COMPANY="${NO_INSOLVENCY_COMPANY:-00445790}"
MANY_CHARGES_COMPANY="${MANY_CHARGES_COMPANY:-00445790}"
FILINGS_COMPANY="${FILINGS_COMPANY:-00445790}"
OFFICERS_COMPANY="${OFFICERS_COMPANY:-00445790}"

CLEANUP="${CLEANUP:-1}"

: "${CH_API_KEY:?Set CH_API_KEY first}"
: "${NOTION_TOKEN:?Set NOTION_TOKEN first}"
: "${NOTION_PARENT_PAGE_ID:?Set NOTION_PARENT_PAGE_ID first}"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "node is required for JSON parsing" >&2; exit 2; }

PROBE_TMP="$(mktemp -d)"
trap 'rm -rf "$PROBE_TMP"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
PROBE_COUNT=0
POST_VERSION=""
ACTIVE_NOTION_VERSION=""

: > "$PROBE_TMP/probe_ids"
: > "$PROBE_TMP/accepted_versions"
: > "$PROBE_TMP/read_ok_versions"

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS  %s\n' "$*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL  %s\n' "$*"; }
info() { printf 'INFO  %s\n' "$*"; }

json_get() { # file dot.path
  node --input-type=commonjs - "$1" "$2" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const path = process.argv[3];
let value;
try {
  value = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  process.stdout.write('null');
  process.exit(0);
}
for (const part of path.split('.')) {
  if (part === '') continue;
  if (value === null || value === undefined) break;
  value = Array.isArray(value) && /^\d+$/.test(part)
    ? value[Number(part)]
    : value[part];
}
if (value === undefined || value === null) {
  process.stdout.write('null');
} else if (typeof value === 'object') {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
NODE
}

show_body() {
  echo "----- raw body -----"
  cat "$1"
  echo
  echo "--------------------"
}

# If a requested page size was ignored and the list is long, show the raw
# top-level object plus the raw first item instead of dumping hundreds of items.
show_envelope_or_first() { # file
  local n
  n=$(json_get "$1" "items.length")
  if [ "$n" != "null" ] && [ "$n" -gt 1 ] 2>/dev/null; then
    echo "API returned $n items despite the requested page size."
    echo "Showing raw top-level fields and raw items[0]:"
    node --input-type=commonjs - "$1" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const top = {};
for (const [k, v] of Object.entries(data)) {
  if (k !== 'items') top[k] = v;
}
process.stdout.write(JSON.stringify(top, null, 2));
process.stdout.write('\n--- items[0] ---\n');
const first = Array.isArray(data.items) ? (data.items[0] ?? null) : null;
process.stdout.write(JSON.stringify(first, null, 2));
process.stdout.write('\n');
NODE
  else
    show_body "$1"
  fi
}

ch_get() { # url outfile -> status
  curl -sS --max-time 30 \
    -u "$CH_API_KEY:" \
    -H 'Accept: application/json' \
    -o "$2" -w '%{http_code}' "$1"
}

notion_request() { # method url version outfile [datafile] -> status
  local method="$1" url="$2" version="$3" out="$4" data="${5:-}"
  local args=(
    -sS --max-time 30 -X "$method" "$url"
    -H "Authorization: Bearer $NOTION_TOKEN"
    -H "Notion-Version: $version"
    -H "Content-Type: application/json"
    -o "$out" -w '%{http_code}'
  )
  if [ -n "$data" ]; then
    args+=(--data-binary "@$data")
  fi
  curl "${args[@]}"
}

probe_notion_version() { # version label
  local version="$1" label="$2"
  local title="DELETE ME - CH probe $version - $(date -u +%Y%m%dT%H%M%SZ)"
  local req="$PROBE_TMP/notion_req_$label.json"
  local resp="$PROBE_TMP/notion_resp_$label.json"

  cat > "$req" <<EOF
{"parent":{"page_id":"$NOTION_PARENT_PAGE_ID"},"properties":{"title":{"title":[{"type":"text","text":{"content":"$title"}}]}}}
EOF

  echo
  echo "===== 1$label. Notion version probe: $version ====="
  echo "POST $NOTION_BASE/pages"
  echo "Request body:"
  cat "$req"
  echo
  local status
  status=$(notion_request POST "$NOTION_BASE/pages" "$version" "$resp" "$req")
  echo "HTTP $status"
  show_body "$resp"

  if [ "$status" = "200" ]; then
    pass "Notion accepted Notion-Version: $version for POST /v1/pages"
    local id
    id=$(json_get "$resp" "id")
    echo "Created page id: $id"
    if [ "$id" != "null" ] && [ -n "$id" ]; then
      printf '%s\n' "$id" >> "$PROBE_TMP/probe_ids"
      PROBE_COUNT=$((PROBE_COUNT + 1))
    fi
    printf '%s\n' "$version" >> "$PROBE_TMP/accepted_versions"
    return 0
  fi

  fail "Notion rejected Notion-Version: $version for POST /v1/pages (HTTP $status)"

  # The POST may fail on permissions rather than the version. A read-only
  # call isolates the version header. This endpoint is already verified.
  local read_url="$NOTION_BASE/blocks/$NOTION_PARENT_PAGE_ID/children?page_size=1"
  local read_resp="$PROBE_TMP/notion_read_$label.json"
  local read_status
  read_status=$(notion_request GET "$read_url" "$version" "$read_resp")
  echo "Read-only version probe: GET $read_url"
  echo "HTTP $read_status"
  show_body "$read_resp"

  if [ "$read_status" = "200" ]; then
    printf '%s\n' "$version" >> "$PROBE_TMP/read_ok_versions"
    info "Read access works with $version. The POST failure above is likely permissions or request-body related, not version rejection."
  fi
  return 1
}

echo "===== CH + NOTION LIVE PROBE ====="
echo "PSC none:        $NO_PSC_COMPANY"
echo "Charges none:    $NO_CHARGES_COMPANY"
echo "Insolvency none: $NO_INSOLVENCY_COMPANY"
echo "Many charges:    $MANY_CHARGES_COMPANY"
echo "Filing item:     $FILINGS_COMPANY"
echo "Officers:        $OFFICERS_COMPANY"
echo "Notion parent:   $NOTION_PARENT_PAGE_ID"
echo

probe_notion_version "$NOTION_VERSION_NEW" "a" || true
probe_notion_version "$NOTION_VERSION_FALLBACK" "b" || true

if grep -qx "$NOTION_VERSION_NEW" "$PROBE_TMP/accepted_versions" 2>/dev/null; then
  POST_VERSION="$NOTION_VERSION_NEW"
elif grep -qx "$NOTION_VERSION_FALLBACK" "$PROBE_TMP/accepted_versions" 2>/dev/null; then
  POST_VERSION="$NOTION_VERSION_FALLBACK"
fi

ACTIVE_NOTION_VERSION="$POST_VERSION"
if [ -z "$ACTIVE_NOTION_VERSION" ]; then
  ACTIVE_NOTION_VERSION=$(head -n 1 "$PROBE_TMP/read_ok_versions" 2>/dev/null || true)
fi

echo
if [ -n "$POST_VERSION" ]; then
  info "POST accepted: $POST_VERSION"
elif [ -n "$ACTIVE_NOTION_VERSION" ]; then
  info "No POST was accepted, but reads worked with: $ACTIVE_NOTION_VERSION"
else
  info "No Notion version was accepted; check 8 will be skipped"
fi

# ---------- 2. PSC with none ----------
echo
echo "===== 2. PSC with none: $NO_PSC_COMPANY ====="
PSC_URL="$CH_BASE/company/$NO_PSC_COMPANY/persons-with-significant-control?items_per_page=100&start_index=0"
PSC_STATUS=$(ch_get "$PSC_URL" "$PROBE_TMP/psc.json")
echo "GET $PSC_URL"
echo "HTTP $PSC_STATUS"
show_body "$PROBE_TMP/psc.json"

case "$PSC_STATUS" in
  200)
    PSC_N=$(json_get "$PROBE_TMP/psc.json" "items.length")
    if [ "$PSC_N" = "0" ]; then
      pass "PSC: 200 with empty items[]"
      info "VERDICT: 200 with empty items[] - 200+0 must also map to no data"
    elif [ "$PSC_N" = "null" ]; then
      fail "PSC: 200 but no items[] array"
      info "VERDICT: 200 without items[]; inspect raw body"
    else
      fail "PSC: 200 with $PSC_N item(s); this is not a no-PSC case"
      info "VERDICT: 200 with items"
    fi
    ;;
  404)
    pass "PSC: 404"
    info "VERDICT: 404 - 404-to-null is correct for this endpoint/company"
    ;;
  *)
    fail "PSC: unexpected HTTP $PSC_STATUS"
    info "VERDICT: unexpected"
    ;;
esac

# ---------- 3. Charges with none ----------
echo
echo "===== 3. Charges with none: $NO_CHARGES_COMPANY ====="
P3_STATUS=$(ch_get "$CH_BASE/company/$NO_CHARGES_COMPANY" "$PROBE_TMP/profile3.json")
echo "Profile GET /company/$NO_CHARGES_COMPANY -> HTTP $P3_STATUS"
if [ "$P3_STATUS" = "200" ]; then
  HAS_CHARGES=$(json_get "$PROBE_TMP/profile3.json" "has_charges")
  info "profile.has_charges = $HAS_CHARGES"
  if [ "$HAS_CHARGES" = "true" ]; then
    fail "NO_CHARGES_COMPANY has has_charges=true; override NO_CHARGES_COMPANY"
  fi
else
  info "Profile call failed; continuing to the charges call anyway"
fi

CHARGES0_URL="$CH_BASE/company/$NO_CHARGES_COMPANY/charges"
C0_STATUS=$(ch_get "$CHARGES0_URL" "$PROBE_TMP/charges_none.json")
echo "GET $CHARGES0_URL"
echo "HTTP $C0_STATUS"
show_body "$PROBE_TMP/charges_none.json"

case "$C0_STATUS" in
  200)
    C0_N=$(json_get "$PROBE_TMP/charges_none.json" "items.length")
    C0_TOTAL=$(json_get "$PROBE_TMP/charges_none.json" "total_count")
    info "items.length = $C0_N; total_count = $C0_TOTAL"
    if [ "$C0_N" = "0" ] || [ "$C0_TOTAL" = "0" ]; then
      pass "Charges: 200 with no charges"
      info "VERDICT: 200 with zero charges"
    else
      fail "Charges: 200 with data; this is not a no-charges case"
      info "VERDICT: 200 with items"
    fi
    ;;
  404)
    pass "Charges: 404"
    info "VERDICT: 404 - 404-to-null is correct for this endpoint/company"
    ;;
  *)
    fail "Charges: unexpected HTTP $C0_STATUS"
    info "VERDICT: unexpected"
    ;;
esac

# ---------- 4. Insolvency with no history ----------
echo
echo "===== 4. Insolvency with no history: $NO_INSOLVENCY_COMPANY ====="
P4_STATUS=$(ch_get "$CH_BASE/company/$NO_INSOLVENCY_COMPANY" "$PROBE_TMP/profile4.json")
if [ "$P4_STATUS" = "200" ]; then
  info "profile.has_insolvency_history = $(json_get "$PROBE_TMP/profile4.json" "has_insolvency_history")"
  info "profile.company_status = $(json_get "$PROBE_TMP/profile4.json" "company_status")"
fi

INS_URL="$CH_BASE/company/$NO_INSOLVENCY_COMPANY/insolvency"
INS_STATUS=$(ch_get "$INS_URL" "$PROBE_TMP/insolvency.json")
echo "GET $INS_URL"
echo "HTTP $INS_STATUS"
show_body "$PROBE_TMP/insolvency.json"

case "$INS_STATUS" in
  200)
    INS_CASES=$(json_get "$PROBE_TMP/insolvency.json" "cases.length")
    INS_TOPSTATUS=$(json_get "$PROBE_TMP/insolvency.json" "status")
    info "cases.length = $INS_CASES; status = $INS_TOPSTATUS"
    if [ "$INS_CASES" = "0" ] || [ "$INS_CASES" = "null" ]; then
      pass "Insolvency: 200 with no cases"
      info "VERDICT: 200 with no cases"
    else
      fail "Insolvency: 200 with cases; this is not a no-insolvency case"
      info "VERDICT: 200 with cases"
    fi
    ;;
  404)
    pass "Insolvency: 404"
    info "VERDICT: 404 - 404-to-null is correct for this endpoint/company"
    ;;
  *)
    fail "Insolvency: unexpected HTTP $INS_STATUS"
    info "VERDICT: unexpected"
    ;;
esac

# ---------- 5. Charges pagination ----------
echo
echo "===== 5. Charges pagination: $MANY_CHARGES_COMPANY ====="
CHARGES_URL="$CH_BASE/company/$MANY_CHARGES_COMPANY/charges"

C5_URL="$CHARGES_URL?items_per_page=5&start_index=0"
C5_STATUS=$(ch_get "$C5_URL" "$PROBE_TMP/charges5.json")
echo "GET $C5_URL"
echo "HTTP $C5_STATUS"
show_body "$PROBE_TMP/charges5.json"

C5_N=$(json_get "$PROBE_TMP/charges5.json" "items.length")
C5_TOTAL=$(json_get "$PROBE_TMP/charges5.json" "total_count")
C5_SAT=$(json_get "$PROBE_TMP/charges5.json" "satisfied_count")
C5_PART=$(json_get "$PROBE_TMP/charges5.json" "part_satisfied_count")

C1_URL="$CHARGES_URL?items_per_page=1&start_index=0"
C1_STATUS=$(ch_get "$C1_URL" "$PROBE_TMP/charges1.json")
echo "GET $C1_URL"
echo "HTTP $C1_STATUS"
show_body "$PROBE_TMP/charges1.json"

C1_N=$(json_get "$PROBE_TMP/charges1.json" "items.length")
C1_TOTAL=$(json_get "$PROBE_TMP/charges1.json" "total_count")
C1_SAT=$(json_get "$PROBE_TMP/charges1.json" "satisfied_count")
C1_PART=$(json_get "$PROBE_TMP/charges1.json" "part_satisfied_count")

info "items_per_page=5: items.length=$C5_N total_count=$C5_TOTAL satisfied_count=$C5_SAT part_satisfied_count=$C5_PART"
info "items_per_page=1: items.length=$C1_N total_count=$C1_TOTAL satisfied_count=$C1_SAT part_satisfied_count=$C1_PART"

if [ "$C5_STATUS" != "200" ] || [ "$C1_STATUS" != "200" ]; then
  fail "Charges pagination: one or both calls failed"
elif [ "$C1_N" = "1" ] && [ "$C5_N" != "1" ]; then
  if [ "$C1_TOTAL" = "null" ]; then
    pass "items_per_page is respected; total_count is absent"
  elif [ "$C1_TOTAL" -gt 1 ]; then
    pass "items_per_page is respected (1 item returned; total_count=$C1_TOTAL)"
  else
    fail "items_per_page looks respected but total_count=$C1_TOTAL"
  fi
else
  fail "items_per_page=1 was not respected (returned $C1_N items; total_count=$C1_TOTAL)"
fi

# ---------- 6. Raw filing item ----------
echo
echo "===== 6. Raw filing item: $FILINGS_COMPANY ====="
FIL_URL="$CH_BASE/company/$FILINGS_COMPANY/filing-history?items_per_page=1&start_index=0"
FIL_STATUS=$(ch_get "$FIL_URL" "$PROBE_TMP/filing.json")
echo "GET $FIL_URL"
echo "HTTP $FIL_STATUS"
show_envelope_or_first "$PROBE_TMP/filing.json"

FIL_TX=$(json_get "$PROBE_TMP/filing.json" "items.0.transaction_id")
FIL_LINKS=$(json_get "$PROBE_TMP/filing.json" "items.0.links")
FIL_N=$(json_get "$PROBE_TMP/filing.json" "items.length")
info "items.length = $FIL_N"
info "items[0].transaction_id = $FIL_TX"
info "items[0].links = $FIL_LINKS"
if [ "$FIL_STATUS" = "200" ] && [ "$FIL_TX" != "null" ] && [ "$FIL_LINKS" != "null" ]; then
  pass "Filing item carries transaction_id and links"
else
  fail "Filing item missing transaction_id or links, or the call failed"
fi

# ---------- 7. Officer top-level counts ----------
echo
echo "===== 7. Officer top-level counts: $OFFICERS_COMPANY ====="
OFF_URL="$CH_BASE/company/$OFFICERS_COMPANY/officers?items_per_page=1&start_index=0"
OFF_STATUS=$(ch_get "$OFF_URL" "$PROBE_TMP/officers.json")
echo "GET $OFF_URL"
echo "HTTP $OFF_STATUS"
show_envelope_or_first "$PROBE_TMP/officers.json"

OK=1
for field in active_count resigned_count total_results start_index items_per_page; do
  val=$(json_get "$PROBE_TMP/officers.json" "$field")
  echo "$field = $val"
  if [ "$val" = "null" ]; then
    OK=0
  fi
done
OFF_N=$(json_get "$PROBE_TMP/officers.json" "items.length")
info "items.length with items_per_page=1: $OFF_N"
if [ "$OFF_STATUS" = "200" ] && [ "$OK" = "1" ]; then
  pass "Officer response has all top-level count/pagination fields"
else
  fail "Officer response missing top-level count/pagination fields, or the call failed"
fi

# ---------- 8. Notion block children ----------
echo
echo "===== 8. Notion block children: $NOTION_PARENT_PAGE_ID ====="
if [ -z "$ACTIVE_NOTION_VERSION" ]; then
  fail "No accepted Notion-Version; cannot call GET /blocks/.../children"
else
  CHILDREN1_URL="$NOTION_BASE/blocks/$NOTION_PARENT_PAGE_ID/children?page_size=1"
  K1_STATUS=$(notion_request GET "$CHILDREN1_URL" "$ACTIVE_NOTION_VERSION" "$PROBE_TMP/children1.json")
  echo "GET $CHILDREN1_URL"
  echo "HTTP $K1_STATUS"
  show_body "$PROBE_TMP/children1.json"

  if [ "$K1_STATUS" != "200" ]; then
    fail "GET block children failed (HTTP $K1_STATUS)"
  else
    K1_HAS_MORE=$(json_get "$PROBE_TMP/children1.json" "has_more")
    K1_NEXT=$(json_get "$PROBE_TMP/children1.json" "next_cursor")
    K1_FIRST=$(json_get "$PROBE_TMP/children1.json" "results.0.id")
    info "has_more = $K1_HAS_MORE; next_cursor = $K1_NEXT; results[0].id = $K1_FIRST"

    if [ "$K1_HAS_MORE" = "true" ] && [ "$K1_NEXT" != "null" ]; then
      CHILDREN2_URL="$NOTION_BASE/blocks/$NOTION_PARENT_PAGE_ID/children?page_size=1&start_cursor=$K1_NEXT"
      K2_STATUS=$(notion_request GET "$CHILDREN2_URL" "$ACTIVE_NOTION_VERSION" "$PROBE_TMP/children2.json")
      echo "GET $CHILDREN2_URL"
      echo "HTTP $K2_STATUS"
      show_body "$PROBE_TMP/children2.json"

      K2_FIRST=$(json_get "$PROBE_TMP/children2.json" "results.0.id")
      info "second page results[0].id = $K2_FIRST"
      if [ "$K2_STATUS" = "200" ] && [ "$K2_FIRST" != "null" ] && [ "$K2_FIRST" != "$K1_FIRST" ]; then
        pass "page_size=1 and next_cursor/start_cursor pagination work"
      else
        fail "Second page did not return a different block"
      fi
    else
      fail "has_more=false or next_cursor=null; cannot confirm pagination"
      info "Expected if the parent page has only one direct child block."
    fi

    # Find a child_page block across up to 5 pages of 100.
    CHILD_FOUND=0
    CURSOR=""
    for PAGE in 1 2 3 4 5; do
      SCAN_URL="$NOTION_BASE/blocks/$NOTION_PARENT_PAGE_ID/children?page_size=100"
      if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
        SCAN_URL="$SCAN_URL&start_cursor=$CURSOR"
      fi
      SCAN_STATUS=$(notion_request GET "$SCAN_URL" "$ACTIVE_NOTION_VERSION" "$PROBE_TMP/children_scan.json")
      echo "Scan page $PAGE: GET $SCAN_URL -> HTTP $SCAN_STATUS"
      if [ "$SCAN_STATUS" != "200" ]; then
        echo "Scan page $PAGE raw body:"
        cat "$PROBE_TMP/children_scan.json"
        echo
        break
      fi

      CHILD_BLOCK=$(node --input-type=commonjs - "$PROBE_TMP/children_scan.json" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const block = (data.results || []).find((b) => b.type === 'child_page');
if (!block) process.exit(1);
process.stdout.write(JSON.stringify(block, null, 2));
NODE
)
      CHILD_EXIT=$?
      if [ "$CHILD_EXIT" -eq 0 ] && [ -n "$CHILD_BLOCK" ]; then
        echo "First child_page block found (raw):"
        printf '%s\n' "$CHILD_BLOCK"
        CHILD_FOUND=1
        break
      fi

      CURSOR=$(json_get "$PROBE_TMP/children_scan.json" "next_cursor")
      SCAN_HAS_MORE=$(json_get "$PROBE_TMP/children_scan.json" "has_more")
      if [ "$SCAN_HAS_MORE" != "true" ]; then
        break
      fi
    done

    if [ "$CHILD_FOUND" = "1" ]; then
      pass "Found a child_page block"
    else
      fail "No child_page block found in the first 5 pages of children"
      info "Expected if check 1 created no page, or if page_size=100 is rejected."
    fi
  fi
fi

# ---------- Cleanup ----------
echo
echo "===== Cleanup ====="
if [ "$CLEANUP" = "1" ] && [ -s "$PROBE_TMP/probe_ids" ]; then
  if [ -z "$ACTIVE_NOTION_VERSION" ]; then
    echo "No accepted Notion version, so probe pages cannot be trashed. IDs:"
    cat "$PROBE_TMP/probe_ids"
  else
    while IFS= read -r PROBE_ID; do
      [ -n "$PROBE_ID" ] || continue
      if [ "$ACTIVE_NOTION_VERSION" = "2022-06-28" ]; then
        printf '%s' '{"archived":true}' > "$PROBE_TMP/cleanup.json"
      else
        printf '%s' '{"in_trash":true}' > "$PROBE_TMP/cleanup.json"
      fi
      CLEAN_STATUS=$(notion_request PATCH "$NOTION_BASE/pages/$PROBE_ID" "$ACTIVE_NOTION_VERSION" "$PROBE_TMP/cleanup_resp.json" "$PROBE_TMP/cleanup.json")
      echo "PATCH /v1/pages/$PROBE_ID -> HTTP $CLEAN_STATUS"
      cat "$PROBE_TMP/cleanup_resp.json"
      echo
      if [ "$CLEAN_STATUS" = "200" ]; then
        echo "Trashed probe page $PROBE_ID"
      else
        echo "Could not trash probe page $PROBE_ID; delete it manually"
      fi
    done < "$PROBE_TMP/probe_ids"
  fi
else
  if [ -s "$PROBE_TMP/probe_ids" ]; then
    echo "CLEANUP=$CLEANUP; probe pages left in place:"
    cat "$PROBE_TMP/probe_ids"
  else
    echo "No probe pages created."
  fi
fi

# ---------- Summary ----------
echo
echo "===== Summary ====="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"
echo "POST-accepted Notion version: ${POST_VERSION:-none}"
echo "Version used for GET checks: ${ACTIVE_NOTION_VERSION:-none}"
echo "Probe pages created: $PROBE_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
