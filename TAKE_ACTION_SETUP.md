# Take Action Feature — Setup Guide

This adds a "contact your legislator" flow to the SLEFLAC tracker: users
enter their street address and ZIP code, get matched to their state
legislators via Open States, and receive an editable, pre-filled email
for the selected bill.

## Architecture

```
Squarespace (tracker embed)
   |
   |  "Take action" link --> take-action.html?bill=HB5280&state=MI
   v
take-action.html (GitHub Pages)
   |
   |-- fetches bills.json for bill details + email template
   |
   |  address lookup (?zip=48933&street=123+Main+St) -->
   v
Cloudflare Worker (holds Open States API key)
   |
   |-- geocodes street address via US Census Bureau Geocoder (free, no key)
   |     falls back to ZIP centroid via Zippopotam.us if address not matched
   |-- calls Open States /people.geo with resulting lat/lng
   v
Returns legislator list to take-action.html
```

## 1. Get an Open States (Plural) API key

1. Go to https://open.pluralpolicy.com/accounts/profile/
2. Create an account, request an API key from your profile page
3. Save the key — you'll add it to the Worker as a secret

## 2. Deploy the Cloudflare Worker

1. Sign up at https://dash.cloudflare.com/sign-up (free)
2. Workers & Pages → Create → Create Worker
3. Name it (e.g. `sleflac-legislator-lookup`)
4. Click "Edit code" and replace the default code with the contents of
   `worker/worker.js`
5. Add the API key as a secret:
   - In the Worker's settings → Variables → Add secret
   - Name: `OPENSTATES_API_KEY`
   - Value: your Open States API key
6. Deploy. Note the Worker's URL — it'll look like:
   `https://sleflac-legislator-lookup.<your-subdomain>.workers.dev/`

### Test the Worker

Visit (in a browser or via curl) with a street address and ZIP:
```
https://sleflac-legislator-lookup.<your-subdomain>.workers.dev/?zip=48933&street=124+W+Allegan+St
```
Or ZIP-only (uses centroid fallback — less precise but useful for a quick test):
```
https://sleflac-legislator-lookup.<your-subdomain>.workers.dev/?zip=48933
```
Should return JSON like:
```json
{
  "zip": "48933",
  "location": { "place_name": "Lansing", "state": "MI" },
  "legislators": [
    { "name": "...", "chamber": "lower", "district": "...", "email": "...", ... },
    ...
  ]
}
```

## 3. Wire the Worker URL into take-action.html

In `take-action.html`, find:
```js
var WORKER_URL = 'https://sleflac-legislator-lookup.rlhigginsjr.workers.dev/';
```
This is already set to the deployed Worker URL. If you ever redeploy to a
different subdomain, update this line to match.

## 4. Add files to the SLEFLAC repo

- `take-action.html` (repo root)
- `worker/worker.js` (for reference/version control — not deployed via
  GitHub Pages, just kept alongside the project)
- Updated `tracked-bills.json` (now includes `email_subject`,
  `email_template`, `chamber_target` per bill)
- Updated `scripts/fetch-bill-status.mjs` (passes the new fields through
  to `bills.json`)
- Updated `squarespace-embed.html` (Take Action button links to
  `take-action.html?bill=...&state=...`)

After committing, run the workflow once (Actions → Update Bill Status →
Run workflow) so `bills.json` includes the new email template fields.

## 5. Update the Squarespace embed

Replace the Code Block contents with the updated `squarespace-embed.html`.

## Adding new bills with take-action support

In `tracked-bills.json`, each entry can include:

```json
{
  "state": "OH",
  "bill_number": "HB123",
  "chamber_target": "lower",
  "email_subject": "Support for HB 123 — ...",
  "email_template": "Dear [LEGISLATOR_NAME],\n\n...\n\n[FULL_NAME]\n[CITY], [STATE]\nMember, [CHAPTER]"
}
```

Placeholders available in `email_template`:
- `[LEGISLATOR_NAME]` — filled from the selected legislator (with title, e.g. "Rep. Jane Smith")
- `[FULL_NAME]`, `[CITY]` — filled from the user's input
- `[STATE]` — from the bill's `state` field
- `[CHAPTER]` — from the bill's `chapter` field

`chamber_target`:
- `"lower"` — only show House/Assembly representatives
- `"upper"` — only show State Senators
- `"both"` (or omit) — show all legislators for that address

If a bill has no `email_template`, the tracker falls back to `advocacy_url`
(an external link) for "Take action," same as before.

## Notes & limitations

- **Email coverage varies by state.** Open States doesn't have email
  addresses for every legislator — some states' legislators only have
  contact forms. The take-action page handles this: if no email is on
  file, the button links to the legislator's contact page instead (if
  available) and shows "No email on file — use contact form."
- **Open States rate limits**: the free tier should comfortably handle
  per-user lookups for a small-to-medium advocacy campaign. If usage
  grows significantly, consider Cloudflare KV caching of address→legislator
  results (most addresses in a district map to the same legislators).
- **Address-to-district accuracy**: the worker uses the US Census Bureau
  Geocoder as the primary lookup, which resolves addresses to parcel-level
  coordinates — accurate for virtually all street addresses. If the Census
  Geocoder cannot match the address (e.g., a very new street or unusual
  format), it falls back to the ZIP code centroid via Zippopotam.us, which
  is accurate for the majority of cases but can occasionally return a
  neighboring district for addresses near district boundaries.
