# جت‌سئو نیوز (JetSEO News)

A Chrome extension for news editors and journalists, by [JetSEO](https://www.jetseo.ir). A side panel with eight tabs:
- **سوژه‌های داغ:** stories that several Iranian news sites are telling right now. Each shows how many Telegram channels told it too, «اول در تلگرام» when a channel was ahead of the sites, and a «ترند» badge when it matches a Google or Wikipedia trend. «کپی» copies it (headline and source links) for the team's Telegram or Bale group.
- **شکاف پوشش:** stories your competitors published and your site did not.
- **تلگرام:** stories only Telegram channels have told so far (no site yet), or the posts spreading fastest for their channel.
- **مطالب ما:** your site's articles of the last 24 hours, how many minutes after the first competitor each came out, and a news SEO check of any of them (title, description, H1, canonical, robots, the image Discover needs, NewsArticle data, publish time, language).
- **ترند گوگل:** today's searches in Iran.
- **ترند ویکی‌پدیا:** Persian Wikipedia articles whose reads jumped yesterday (at least twice the day before and the week before), the most read, or the hot edits: articles several people edited in the last 3 hours, which is where a death or an event shows first.
- **مناسبت‌ها:** today, tomorrow or the day after from Wikipedia's day pages: events, births and deaths with how many years ago (round anniversaries first) and the world days.
- **تنظیمات:** your own filters and alerts.

While Chrome is open, the extension checks every 5 minutes and notifies new coverage gaps and stories with a watched keyword, also those only on Telegram.

The hot stories, the coverage gap, Telegram and the alerts come with the «جت‌سئو نیوز» module, bought in the JetSEO panel (`/panel/NewsModule`). There the subscription owner also manages team members, sites, competitors and team filters. Google Trends, Wikipedia trends and the occasions are free for every signed-in JetSEO user.

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
  - `mine?siteId=&hours=`: the site's own articles, with each one's lag behind the first competitor.
  - `check?url=`: news SEO check of one article, for the team's own sites only.
  - `telegram?mode=only|trend&hours=`: stories only channels told, or the fastest-spreading posts.
  - Free, signed in only: `google`, `wiki?mode=rising|top|edits`, `days?offset=0..2`.
  - A 401 means signed out; the extension forgets the token. A 403 `{reason: "no-module"}` means no subscription; only Google Trends, Wikipedia trends and the occasions stay.
- **Nothing else.** Google Trends, Wikipedia and Telegram are filtered in Iran, so the extension never reads them itself: CoreApi and JetSEO's news loop read them through ai.jetseo.ir (design doc 11-7 in the JetSEO repository). Since 0.5.0 the only host permissions are JetSEO's.

## Release

1. Raise `version` in `manifest.json`.
2. Run `powershell -ExecutionPolicy Bypass -File tools/pack.ps1`. It writes `JetseoNewsExtension-<version>.zip` next to the repository.
3. **Chrome Web Store:** to keep the same id, the first upload must carry the private key of the manifest's `key`. That key is kept outside this repository, never committed (see `.gitignore`).
   - If the store assigns a different id, add that id to jetseo.ir's allowed extension origins, or sign-in will be refused.
