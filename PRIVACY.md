# Privacy Policy — AI Repo Detector

*Last updated: 4 June 2026*

This privacy policy describes how the **AI Repo Detector** browser extension
(the "Extension") handles data. The Extension is open source software; the
source code is available in the extension package on the Chrome Web Store.

## TL;DR

The Extension does not collect, store, or transmit any personal data about
its users. It runs locally in your browser and sends requests only to
`api.github.com` — the official, public GitHub REST API.

## Data the Extension stores locally

The Extension uses `chrome.storage.local` and `chrome.storage.session` to
store the following on your device only. None of this data leaves your
browser except as described under "Outbound network requests" below.

| What | Where | Why | When deleted |
|------|-------|-----|--------------|
| Optional GitHub Personal Access Token | `chrome.storage.local` | To raise the GitHub API rate limit from 60 to 5000 requests/hour, if the user chooses to provide one | When the user clears it in the popup, or uninstalls the extension |
| Cached analysis results per repository (TTL 1 hour) | `chrome.storage.session` | To avoid duplicate GitHub API requests for the same repository within a short period | Automatically when the browser session ends, or after 1 hour |

The token is set by the user manually in the Extension popup and is never
collected automatically.

## Outbound network requests

The Extension only contacts one external host: **`api.github.com`** — the
public GitHub REST API operated by GitHub, Inc.

Only the following endpoints are requested:

- `GET /repos/{owner}/{repo}`
- `GET /repos/{owner}/{repo}/readme`
- `GET /repos/{owner}/{repo}/commits`
- `GET /repos/{owner}/{repo}/commits/{sha}`
- `GET /repos/{owner}/{repo}/pulls`
- `GET /repos/{owner}/{repo}/contents`
- `GET /rate_limit`

These requests are triggered solely by the user navigating to a
`https://github.com/{owner}/{repo}` page in their browser. The `{owner}` and
`{repo}` values are taken from the URL of the current GitHub page.

If a Personal Access Token is stored, it is sent **only** in the
`Authorization: Bearer …` header of these GitHub API requests, and **only**
to `api.github.com`. It is never sent to any other server, including the
extension author's own infrastructure.

## What the Extension does NOT do

- Does not contact any server other than `api.github.com`.
- Does not collect, store, or transmit personal information such as name,
  email, IP address, location, browsing history, or authentication
  credentials of any kind.
- Does not display advertising.
- Does not include analytics, telemetry, or crash reporting.
- Does not use cookies.
- Does not sell or share user data with third parties.
- Does not use user data for credit, lending, or financial decisions.

## Permissions

The Extension requests the following permissions, each used solely for the
purposes described above:

- `storage` — local persistence of the optional GitHub token and per-session
  analysis cache.
- `host_permissions: https://api.github.com/*` — making GitHub REST API
  requests for the currently viewed repository.
- `content_scripts` on `https://github.com/*` — detecting which repository
  page the user is viewing and rendering the score badge on that page. No
  user input from the page is read or transmitted.

## Changes to this policy

If this policy is updated, the new version will be posted at the same URL
along with a new "Last updated" date.

## Contact

For questions about this privacy policy:
**ShyDamn** — via the issue tracker of the extension's repository.