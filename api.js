// «جت‌سئو نیوز»: the account, CoreApi calls and text folding, shared by the side panel and the background.
// Sign-in is the JetSEO extension's: the user signs in on jetseo.ir, which returns to /extension/connected;
// POST /extension/token, sent with the site's cookie, then gives this browser a token (the site accepts only
// this extension's id, fixed by the manifest key). CoreApi's api/News endpoints take it in X-JetSEO-User:
// 401 = signed out or revoked, 403 {reason: "no-module"} = no subscription (the free part still works).
// Function declarations only: the background loads this with importScripts, the panel with a script tag.

var NEWS_SITE = "https://www.jetseo.ir";
var NEWS_API = "https://coreapi.jetseo.ir/api/News";
var NEWS_ACCOUNT_KEY = "newsAccount";
var NEWS_PREFS_KEY = "newsPrefs";

function newsLoginUrl() {
  return `${NEWS_SITE}/home/login?ReturnUrl=${encodeURIComponent("/extension/connected")}&utm_source=jetseo_news_extension&utm_medium=login`;
}

// { token, userName } or null.
async function newsAccount() {
  try {
    const { [NEWS_ACCOUNT_KEY]: account } = await chrome.storage.local.get(NEWS_ACCOUNT_KEY);
    return account?.token ? account : null;
  } catch (error) {
    return null;
  }
}

// Asks jetseo.ir for a token with the site's cookie. null when nobody is signed in there; newsConnect.refused
// is true on 403 (the site does not know this extension's id: signing in again cannot help).
async function newsConnect() {
  newsConnect.refused = false;
  try {
    const response = await fetch(`${NEWS_SITE}/extension/token`, { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
    newsConnect.refused = response.status === 403;
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.token) return null;
    const account = { token: data.token, userName: data.userName ?? "" };
    await chrome.storage.local.set({ [NEWS_ACCOUNT_KEY]: account });
    return account;
  } catch (error) {
    return null;
  }
}

async function newsSignOut() {
  const account = await newsAccount();
  await chrome.storage.local.remove([NEWS_ACCOUNT_KEY, "newsSeen", "newsState"]);
  if (account) {
    // revokes the token on the server; signing out here works even if this fails
    fetch("https://coreapi.jetseo.ir/api/Extension/signout", { method: "POST", credentials: "omit", headers: { "X-JetSEO-User": account.token } }).catch(() => {});
  }
}

// GET an api/News path: { status, data }. status 0 = no network; a 401 forgets the account.
async function newsApi(path) {
  const account = await newsAccount();
  if (!account) return { status: 401, data: null };
  try {
    const response = await fetch(`${NEWS_API}/${path}`, { credentials: "omit", headers: { "X-JetSEO-User": account.token, Accept: "application/json" } });
    if (response.status === 401) await chrome.storage.local.remove(NEWS_ACCOUNT_KEY);
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, data: null };
  }
}

// Personal settings (chrome.storage.sync): excluded words, muted source domains, notifications.
async function newsPrefs() {
  const { [NEWS_PREFS_KEY]: prefs = {} } = await chrome.storage.sync.get(NEWS_PREFS_KEY).catch(() => ({}));
  return {
    excluded: prefs.excluded ?? [],
    muted: prefs.muted ?? [],
    notifyGap: prefs.notifyGap ?? true,
    notifyWatch: prefs.notifyWatch ?? true,
    topicHours: prefs.topicHours ?? 3,
    minSources: prefs.minSources ?? 2,
    gapHours: prefs.gapHours ?? 6,
    telegramHours: prefs.telegramHours ?? 6,
  };
}

async function saveNewsPrefs(changes) {
  const prefs = { ...(await newsPrefs()), ...changes };
  await chrome.storage.sync.set({ [NEWS_PREFS_KEY]: prefs });
  return prefs;
}

// As the server compares filters (CoreApi NewsData.Fold): Arabic ي/ى/ك/ة, ZWNJ as a space, lower case,
// Persian and Arabic digits as 0-9, every other non-letter as a space.
function newsFold(text) {
  let s = String(text ?? "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه").replace(/‌/g, " ").toLowerCase();
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  return s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Whole words only, as the team filters' default: «ایران» does not hide «ایرانسل».
function newsMatches(foldedText, word) {
  const w = newsFold(word);
  return w.length > 0 && ` ${foldedText} `.includes(` ${w} `);
}

// The stories the user's own filters leave: none of their words in any headline, none only from muted sources.
function newsPersonal(stories, prefs) {
  const muted = new Set(prefs.muted.map((d) => d.toLowerCase()));
  return (stories ?? [])
    .map((s) => ({ ...s, items: (s.items ?? []).filter((i) => !muted.has(String(i.domain).toLowerCase())) }))
    .filter((s) => s.items.length > 0)
    .filter((s) => !s.items.some((i) => prefs.excluded.some((w) => newsMatches(newsFold(i.title), w))));
}
