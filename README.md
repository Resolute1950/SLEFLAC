# SLEFLAC — National Veteran Bill Tracker

Tracks the status of a curated list of state veteran-related bills via the
[LegiScan API](https://legiscan.com/legiscan), and provides an embeddable
widget for [self-moaa.com](https://self-moaa.com) (Squarespace) showing
live status plus "take action" links per bill.

## How it works

1. **`tracked-bills.json`** — the curated list of bills to track. Each entry
   has `state`, `bill_number`, plus display metadata (`label`, `category`,
   `chapter`, `summary`, `priority`, `advocacy_url`).

2. **`scripts/fetch-bill-status.mjs`** — reads `tracked-bills.json`, queries
   LegiScan for each bill's current status, and writes `bills.json`.

3. **`.github/workflows/update-bill-status.yml`** — runs the script daily
   (12:00 UTC) and whenever `tracked-bills.json` changes, committing the
   updated `bills.json`.

4. **`bills.json`** — served via GitHub Pages, fetched client-side by the
   Squarespace embed. No API key is ever exposed to the browser.

5. **`squarespace-embed.html`** — paste into a Squarespace Code Block. Fetches
   `bills.json` and renders the tracker grouped by category, with status
   badges and "Take action" buttons.

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
In Squarespace: edit the target page → add a **Code Block** → paste the
contents of `squarespace-embed.html` → save.

If your GitHub username/org or repo name differs from `Resolute1950/SLEFLAC`,
update `DATA_URL` near the top of the `<script>` in `squarespace-embed.html`
accordingly.

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
  "advocacy_url": "https://link-to-take-action-page"
}
```

Commit the change — the workflow runs automatically on push to
`tracked-bills.json` and will populate status for the new bill within
a minute or two.

`state` must be the bill's 2-letter state postal code (LegiScan uses these
directly). `bill_number` must match LegiScan's format (e.g. `HB123`, `SB45`,
no space).

## Notes on API usage

LegiScan's free Public API allows 30,000 queries/month. Each state with
tracked bills costs 2 queries (session lookup + master list) plus 1 query
per bill, run once daily. With a handful of states and bills this is well
under 1,000 queries/month.
