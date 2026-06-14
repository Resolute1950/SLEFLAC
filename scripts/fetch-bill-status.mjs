// scripts/fetch-bill-status.mjs
//
// Fetches current status for the four Michigan veteran-related bills
// (HB 5262, 5278, 5279, 5280) from the LegiScan API and writes the
// result to bills.json at the repo root, which the site fetches
// client-side to render status badges and the tracker section.
//
// Requires env var LEGISCAN_API_KEY (set as a GitHub Actions secret).
//
// LegiScan API docs: https://legiscan.com/gaits/documentation/legiscan

const API_KEY = process.env.LEGISCAN_API_KEY;

if (!API_KEY) {
  console.error("Missing LEGISCAN_API_KEY environment variable.");
  process.exit(1);
}

// LegiScan bill IDs change per session, so we look bills up by
// state + bill number using the getSearch / getBill pattern.
// getBill accepts either an "id" (LegiScan internal bill id) or
// a combination that requires a search first. Easiest stable
// approach: use getMasterListRaw is overkill; instead we use
// getSearch to resolve bill number -> LegiScan bill id, then getBill.

const STATE = "MI";
const BILL_NUMBERS = ["HB5262", "HB5278", "HB5279", "HB5280"];

const BASE_URL = "https://api.legiscan.com/";

async function legiscanGet(op, params) {
  const url = new URL(BASE_URL);
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`LegiScan API error for op=${op}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`LegiScan API returned non-OK status for op=${op}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Resolve all bill numbers to LegiScan internal bill_ids in one shot via
// getSessionList (find current MI session) + getMasterListRaw (full bill
// list for that session, keyed by bill_id with bill_number on each entry).
async function buildBillIdMap(state, billNumbers) {
  // 1. Find the current/most recent regular session for the state
  const sessionData = await legiscanGet("getSessionList", { state });
  const sessions = sessionData.sessions || [];
  // Prefer the session marked current; fall back to the most recent by year
  let session = sessions.find((s) => s.session_tag === "Regular Session" && s.session_id && s.year_end >= new Date().getFullYear() && !s.special)
    || sessions.find((s) => s.year_end >= new Date().getFullYear())
    || sessions[sessions.length - 1];

  if (!session) {
    throw new Error(`No session found for state ${state}`);
  }

  console.log(`Using session: ${session.session_name} (id ${session.session_id})`);

  // 2. Pull the full master list for that session
  const masterData = await legiscanGet("getMasterListRaw", { id: session.session_id });
  const masterList = masterData.masterlist || {};

  // 3. Build a lookup from normalized bill number -> bill_id
  const map = {};
  for (const key of Object.keys(masterList)) {
    if (key === "session") continue;
    const entry = masterList[key];
    if (!entry || !entry.number) continue;
    const normalized = entry.number.replace(/\s+/g, "").toUpperCase();
    map[normalized] = entry.bill_id;
  }

  const result = {};
  for (const billNumber of billNumbers) {
    const normalized = billNumber.replace(/\s+/g, "").toUpperCase();
    result[billNumber] = map[normalized] || null;
  }
  return result;
}

async function fetchBillDetail(billId) {
  const data = await legiscanGet("getBill", { id: billId });
  return data.bill;
}

// LegiScan progress/status codes -> human-readable labels
const STATUS_LABELS = {
  0: "Pending",
  1: "Introduced",
  2: "Engrossed",
  3: "Enrolled",
  4: "Passed",
  5: "Vetoed",
  6: "Failed / Dead",
};

function simplifyBill(bill) {
  const history = bill.history || [];
  const lastAction = history.length ? history[history.length - 1] : null;

  return {
    bill_number: bill.bill_number,
    title: bill.title,
    description: bill.description,
    status: bill.status,
    status_label: STATUS_LABELS[bill.status] || "Unknown",
    last_action_date: lastAction ? lastAction.date : null,
    last_action: lastAction ? lastAction.action : null,
    committee: bill.committee ? bill.committee.name : null,
    state_link: bill.state_link,
    legiscan_url: bill.url,
    updated: new Date().toISOString(),
  };
}

async function main() {
  const results = [];

  console.log(`Resolving bill IDs for ${STATE}: ${BILL_NUMBERS.join(", ")}`);
  const billIdMap = await buildBillIdMap(STATE, BILL_NUMBERS);

  for (const billNumber of BILL_NUMBERS) {
    try {
      const billId = billIdMap[billNumber];
      if (!billId) {
        console.warn(`Could not resolve bill_id for ${billNumber}`);
        results.push({
          bill_number: billNumber,
          status_label: "Not found",
          updated: new Date().toISOString(),
        });
        continue;
      }

      console.log(`Fetching detail for ${billNumber} (id ${billId})...`);
      const bill = await fetchBillDetail(billId);
      results.push(simplifyBill(bill));

      // Be polite to the API
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`Error fetching ${billNumber}:`, err.message);
      results.push({
        bill_number: billNumber,
        status_label: "Error",
        error: err.message,
        updated: new Date().toISOString(),
      });
    }
  }

  const output = {
    generated: new Date().toISOString(),
    state: STATE,
    bills: results,
  };

  const fs = await import("fs/promises");
  await fs.writeFile("bills.json", JSON.stringify(output, null, 2));
  console.log("Wrote bills.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
