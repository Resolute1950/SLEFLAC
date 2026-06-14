# Take Action Feature — Setup Guide

This adds a "contact your legislator" flow to the SLEFLAC tracker: users
enter their ZIP, get matched to their state legislators via Open States,
and receive an editable, pre-filled email for the selected bill.

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
   |  ZIP lookup -->
   v
Cloudflare Worker (holds Open States API key)
   |
   |-- geocodes ZIP via Zippopotam.us (free, no key)
   |-- calls Open States /people.geo with lat/lng
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

Visit (in a browser or via curl):
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
var WORKER_URL = 'https://sleflac-legislator-lookup.YOUR_SUBDOMAIN.workers.dev/'; // TODO
```
Replace with your actual Worker URL from step 2.

## 4. Add files to the SLEFLAC repo

- `take-action.html` (repo root)
- `worker/worker.js` (for reference/version control — not deployed via
  GitHub Pages, just kept alongside the project)
- Updated `tracked-bills.json` (now includes `email_subject`,
  `email_template`, `chamber_target` per bill)
- Updated `scripts/fetch-bill-status.mjs` (passes the new fields through
  to `bills.json`)
- Updated `squarespace-embed-v2.html` (Take Action button now links to
  `take-action.html?bill=...&state=...`)

After committing, run the workflow once (Actions → Update Bill Status →
Run workflow) so `bills.json` includes the new email template fields.

## 5. Update the Squarespace embed

Replace the Code Block contents with the updated `squarespace-embed-v2.html`.

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
  grows significantly, consider Cloudflare KV caching of ZIP→legislator
  results (most ZIPs map to the same few legislators repeatedly).
- **ZIP-to-district accuracy**: ZIP codes don't align perfectly with
  legislative districts (a ZIP can span multiple districts). The
  Zippopotam.us + Open States geo lookup uses the ZIP's centroid point,
  which is accurate for the large majority of addresses but can
  occasionally return a neighboring district for ZIPs near district
  boundaries. This is a standard limitation of ZIP-based lookups.
