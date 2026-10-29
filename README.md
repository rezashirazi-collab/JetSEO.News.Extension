# جت‌سئو نیوز (JetSEO News)

A Chrome extension for news editors and journalists, by [JetSEO](https://www.jetseo.ir). A side panel with four tabs:
- **سوژه‌های داغ:** stories that several Iranian news sites are telling right now.
- **شکاف پوشش:** stories your competitors published and your site did not.
- **ترند گوگل:** today's searches in Iran.
- **تنظیمات:** your own filters and alerts.

While Chrome is open, the extension checks every 5 minutes and notifies new coverage gaps and stories with a watched keyword.

The hot stories, the coverage gap and the alerts come with the «جت‌سئو نیوز» module, bought in the JetSEO panel (`/panel/NewsModule`). There the subscription owner also manages team members, sites, competitors and team filters. Google Trends is free for every signed-in JetSEO user.

## Install (development)

1. Clone this repository, or unzip a release.
2. Open `chrome://extensions` and switch on «Developer mode».
3. Click «Load unpacked» and choose the folder.
4. Click the extension's icon to open the side panel. Click «ورود به جت‌سئو», sign in on jetseo.ir, and come back.

Chrome 116 or later.

## Files

| File | What |
|---|---|
| `manifest.json` | MV3. The `key` fixes the extension id to `eooiikfbhffioefpapknekohmpningie`; jetseo.ir hands sign-in tokens only to known extension ids. |
| `api.js` | The account (sign-in hand-off, token), calls to the JetSEO API, personal preferences, and the text folding the server's filters use. |
| `background.js` | Finishes the sign-in when jetseo.ir's `/extension/connected` page opens. Every 5 minutes: alerts, and the number of unseen gaps on the icon. |
| `panel.html`, `panel.css`, `panel.js` | The side panel. Every value from the server is escaped (`esc`); links must be `http(s)` (`safeUrl`). |
| `tools/pack.ps1` | Builds the release zip (forward-slash paths, as the Chrome Web Store requires). |

## How it talks to JetSEO

- **Sign-in:** the user signs in on `https://www.jetseo.ir`, which returns to `/extension/connected`. The extension then calls `POST /extension/token` with the site's cookie. The site answers only this extension's id (checked by `Origin`), and the extension keeps the token in `chrome.storage.local`.
- **API:** `https://coreapi.jetseo.ir/api/News/…`, with the token in the `X-JetSEO-User` header.
  - `state`: who you are for the module (owner, member or none), your tier and end date, and the team's sites.
  - `topics?hours=&minSources=`: hot stories, with the team filters already applied.
  - `gap?siteId=&hours=`: a site's coverage gap.
  - A 401 means signed out; the extension forgets the token. A 403 `{reason: "no-module"}` means no subscription; only Google Trends stays.
- **Google Trends:** read by the browser itself, from `https://trends.google.com/trending/rss?geo=IR`.

## Release

1. Raise `version` in `manifest.json`.
2. Run `powershell -ExecutionPolicy Bypass -File tools/pack.ps1`. It writes `JetseoNewsExtension-<version>.zip` next to the repository.
3. **Chrome Web Store:** to keep the same id, the first upload must carry the private key of the manifest's `key`. That key is kept outside this repository, never committed (see `.gitignore`).
   - If the store assigns a different id, add that id to jetseo.ir's allowed extension origins, or sign-in will be refused.
