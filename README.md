# SLEFLAC — State Legislative Tracker for Veteran-Related Bills

A national tracker for state-level, veteran-related legislation, built for
the [State Legislative Exchange Forum (SLEF)](https://www.slef-moaa.com).
Tracks bill status via the [LegiScan API](https://legiscan.com/legiscan) and
provides:

- An embeddable widget for Squarespace (`/slac` on self-moaa.com) showing
  live bill status, grouped by category, with a state selector
- A "Take action" feature that looks up a user's state legislators by ZIP
  code (via the [Open States API](https://open.pluralpolicy.com/)) and
  generates a pre-filled, editable email in support of a given bill
- A "Suggest a bill" link so MOAA members can flag new bills for tracking

No API keys are ever exposed to the browser — LegiScan calls happen in
GitHub Actions, and Open States calls happen in a Cloudflare Worker.

---

## How it works

### 1. Bill status tracking

- **`tracked-bills.json`** — the curated list of bills to track. Each entry
  has `state`, `bill_number`, plus display metadata (`label`, `category`,
  `chapter`, `summary`, `priority`, `advocacy_url`) and, optionally,
  take-action fields (`chamber_target`, `email_subject`, `email_template`).

- **`scripts/fetch-bill-status.mjs`** — reads `tracked-bills.json`, queries
  LegiScan for each bill's current status (with automatic retry on
  transient network errors), and writes `bills.json`.

- **`.github/workflows/update-bill-status.yml`** — runs the script daily
  (12:00 UTC) and whenever `tracked-bills.json` changes, committing the
  updated `bills.json`.

- **`bills.json`** — served via GitHub Pages, fetched client-side by the
  Squarespace embed and the take-action page.

### 2. Tracker widget

- **`squarespace-embed-v2.html`** — paste into a Squarespace Code Block.
  Fetches `bills.json` and renders:
  - An intro blurb explaining how the tracker works
  - A **state selector** (pills), built dynamically from the distinct
    `state` values in `bills.json` — new states appear automatically as
    bills are added, no embed changes needed
  - Bills for the selected state, grouped by `category`, as full-width rows
    with a live status badge, last-action summary, and a "Take action" button
  - A **"Suggest a bill"** footer link (see below)

### 3. Take action (contact your legislator)

- **`take-action.html`** — standalone page (served via GitHub Pages) reached
  via `take-action.html?bill=<bill_number>&state=<state>`. Walks the user
  through:
  1. Enter ZIP code
  2. Select their state legislator (filtered by the bill's `chamber_target`)
  3. Enter their name and city
  4. Review/edit a pre-filled email, then send via `mailto:` or copy the text

- **`worker/worker.js`** — Cloudflare Worker that the take-action page calls
  for the ZIP → legislator lookup. It:
  1. Geocodes the ZIP via Zippopotam.us (free, no key)
  2. Calls Open States `/people.geo` with the resulting lat/lng, using
     `OPENSTATES_API_KEY` (stored as a Worker secret — never sent to the browser)
  3. Filters out federal Congress members, returning only state legislators
  4. Returns a simplified legislator list (name, chamber, district, email
     if available, contact URL as fallback)

  See **`TAKE_ACTION_SETUP.md`** for full deployment steps.

### 4. Suggest a bill

The tracker footer includes a "Suggest a bill" link — a `mailto:` to
`team@slef-moaa.com` with a pre-filled template (state, bill number, title,
category, summary, why it matters, priority, submitter name/chapter). No
form, no password — submissions arrive as email for manual review. To add
an approved suggestion, follow "Adding new bills" below.

---

## Setup

### 1. Add the LegiScan API key as a repo secret
Settings → Secrets and variables → Actions → New repository secret
- Name: `LEGISCAN_API_KEY`
- Value: your free LegiScan API key (https://legiscan.com/legiscan)

### 2. Enable GitHub Pages
Settings → Pages → Source: Deploy from a branch → `main` / `(root)`

### 3. Run the workflow once manually
Actions tab → "Update Bill Status" → Run workflow

### 4. Confirm `bills.json` is live
Visit `https://<your-username>.github.io/SLEFLAC/bills.json` — should
return JSON with current bill statuses.

### 5. Add the tracker to self-moaa.com
In Squarespace: edit the `/slac` page → add a **Code Block** in a
full-width section → paste the contents of `squarespace-embed-v2.html` →
save.

If your GitHub username/org or repo name differs from `Resolute1950/SLEFLAC`,
update `DATA_URL` near the top of the `<script>` in both
`squarespace-embed-v2.html` and `take-action.html`, and `TAKE_ACTION_BASE` in
`squarespace-embed-v2.html`.

### 6. Set up the Take Action feature
See **`TAKE_ACTION_SETUP.md`** for deploying the Cloudflare Worker, getting
an Open States API key, and wiring the Worker URL into `take-action.html`.

---

## Adding new bills

Edit `tracked-bills.json` and add a new entry to the `bills` array:

```json
{
  "state": "OH",
  "bill_number": "HB123",
  "label": "Short descriptive name",
  "category": "Category for grouping on the page",
  "chapter": "Which MOAA chapter/council is tracking this",
  "summary": "1-2 sentence plain-language summary",
  "priority": false,
  "advocacy_url": "https://link-to-fallback-take-action-page",
  "chamber_target": "lower",
  "email_subject": "Support for HB 123 — Short Description",
  "email_template": "Dear [LEGISLATOR_NAME],\n\n...\n\nRespectfully,\n[FULL_NAME]\n[CITY], [STATE]\nMember, [CHAPTER]"
}
```

Field notes:

- `state` — 2-letter postal code (used for both LegiScan and Open States)
- `bill_number` — must match LegiScan's format (e.g. `HB123`, `SB45`, no space)
- `category` — bills are grouped under this heading on the tracker; a new
  category creates a new section automatically
- `chamber_target` — `"lower"` (House/Assembly), `"upper"` (Senate), or
  `"both"`. Determines which legislators from the ZIP lookup are offered as
  recipients on the take-action page
- `email_subject` / `email_template` — required for the take-action page to
  work for this bill. If omitted, "Take action" falls back to `advocacy_url`
  (or shows no button if that's also missing)
- `email_template` placeholders: `[LEGISLATOR_NAME]`, `[FULL_NAME]`,
  `[CITY]`, `[STATE]`, `[CHAPTER]`

Commit the change — the workflow runs automatically on push to
`tracked-bills.json` and will populate status for the new bill within a
minute or two. Adding a bill from a new state automatically adds a new pill
to the tracker's state selector — no embed changes needed.

---

## Notes on API usage

- **LegiScan**: free Public API allows 30,000 queries/month. Each state with
  tracked bills costs 2 queries (session lookup + master list) plus 1 query
  per bill, run once daily. With a handful of states and bills this is well
  under 1,000 queries/month.
- **Open States**: free tier should comfortably handle per-user take-action
  lookups for a small-to-medium campaign. ZIP-based lookups use the ZIP's
  geographic centroid, which is accurate for the large majority of addresses
  but can occasionally return a neighboring district near boundaries.
- **Email coverage** for state legislators varies — some don't have an email
  on file in Open States. The take-action page falls back to the
  legislator's contact page in that case.
