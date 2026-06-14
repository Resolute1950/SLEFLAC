// scripts/fetch-bill-status.mjs
//
// Reads tracked-bills.json (curated list of {state, bill_number, ...}),
// fetches current status for each from the LegiScan API, and writes
// bills.json with merged status + the original metadata (label,
// category, chapter, summary, priority, advocacy_url).
//
// Requires env var LEGISCAN_API_KEY (set as a GitHub Actions secret).
//
// LegiScan API docs: https://legiscan.com/gaits/documentation/legiscan

import fs from "fs/promises";

const API_KEY = process.env.LEGISCAN_API_KEY;

if (!API_KEY) {
  console.error("Missing LEGISCAN_API_KEY environment variable.");
  process.exit(1);
}

const BASE_URL = "https://api.legiscan.com/";
const TRACKED_BILLS_FILE = "tracked-bills.json";
const OUTPUT_FILE = "bills.json";

async function legiscanGet(op, params, retries = 3) {
  const url = new URL(BASE_URL);
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`LegiScan API error for op=${op}: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data.status !== "OK") {
        throw new Error(`LegiScan API returned non-OK status for op=${op}: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = attempt * 2000; // 2s, 4s, ...
        console.warn(`  Attempt ${attempt}/${retries} failed for op=${op} (${err.message}). Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// Build a map of normalized bill_number -> bill_id for a given state's
// current session, via getSessionList + getMasterListRaw.
async function buildBillIdMap(state) {
  const sessionData = await legiscanGet("getSessionList", { state });
  const sessions = sessionData.sessions || [];
  const currentYear = new Date().getFullYear();

  let session =
    sessions.find((s) => s.session_tag === "Regular Session" && !s.special && s.year_end >= currentYear) ||
    sessions.find((s) => s.year_end >= currentYear) ||
    sessions[sessions.length - 1];

  if (!session) {
    throw new Error(`No session found for state ${state}`);
  }

  console.log(`  [${state}] Using session: ${session.session_name} (id ${session.session_id})`);

  const masterData = await legiscanGet("getMasterListRaw", { id: session.session_id });
  const masterList = masterData.masterlist || {};

  const map = {};
  for (const key of Object.keys(masterList)) {
    if (key === "session") continue;
    const entry = masterList[key];
    if (!entry || !entry.number) continue;
    const normalized = entry.number.replace(/\s+/g, "").toUpperCase();
    map[normalized] = entry.bill_id;
  }
  return map;
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

function simplifyBill(bill, meta) {
  const history = bill.history || [];
  const lastAction = history.length ? history[history.length - 1] : null;

  return {
    state: meta.state,
    bill_number: bill.bill_number,
    label: meta.label || null,
    category: meta.category || null,
    chapter: meta.chapter || null,
    summary: meta.summary || bill.description || null,
    priority: !!meta.priority,
    advocacy_url: meta.advocacy_url || null,
    chamber_target: meta.chamber_target || 'both',
    email_subject: meta.email_subject || null,
    email_template: meta.email_template || null,
    title: bill.title,
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

function errorEntry(state, entry, statusLabel, errorMsg) {
  return {
    state,
    bill_number: entry.bill_number,
    label: entry.label || null,
    category: entry.category || null,
    chapter: entry.chapter || null,
    summary: entry.summary || null,
    priority: !!entry.priority,
    advocacy_url: entry.advocacy_url || null,
    chamber_target: entry.chamber_target || 'both',
    email_subject: entry.email_subject || null,
    email_template: entry.email_template || null,
    status_label: statusLabel,
    error: errorMsg,
    updated: new Date().toISOString(),
  };
}

async function main() {
  const trackedRaw = await fs.readFile(TRACKED_BILLS_FILE, "utf-8");
  const tracked = JSON.parse(trackedRaw);
  const trackedBills = tracked.bills || [];

  // Group tracked bills by state so we only build the bill-id map once per state
  const byState = {};
  for (const entry of trackedBills) {
    const state = (entry.state || "").toUpperCase();
    if (!byState[state]) byState[state] = [];
    byState[state].push(entry);
  }

  const results = [];

  for (const [state, entries] of Object.entries(byState)) {
    console.log(`Processing state: ${state} (${entries.length} bill(s))`);
    let billIdMap = {};
    try {
      billIdMap = await buildBillIdMap(state);
    } catch (err) {
      console.error(`  [${state}] Failed to build bill ID map: ${err.message}`);
      for (const entry of entries) {
        results.push(errorEntry(state, entry, "Error", err.message));
      }
      continue;
    }

    for (const entry of entries) {
      const normalized = entry.bill_number.replace(/\s+/g, "").toUpperCase();
      const billId = billIdMap[normalized];
      if (!billId) {
        console.warn(`  [${state}] Could not resolve bill_id for ${entry.bill_number}`);
        results.push(errorEntry(state, entry, "Not found", null));
        continue;
      }

      try {
        console.log(`  [${state}] Fetching detail for ${entry.bill_number} (id ${billId})...`);
        const bill = await fetchBillDetail(billId);
        results.push(simplifyBill(bill, entry));
        await new Promise((r) => setTimeout(r, 400)); // be polite to the API
      } catch (err) {
        console.error(`  [${state}] Error fetching ${entry.bill_number}: ${err.message}`);
        results.push(errorEntry(state, entry, "Error", err.message));
      }
    }
  }

  const output = {
    generated: new Date().toISOString(),
    bills: results,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_FILE} with ${results.length} bill(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
