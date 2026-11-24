// «جت‌سئو نیوز»: the account, CoreApi calls and text folding, shared by the side panel and the background.
// Sign-in is the JetSEO extension's: the user signs in on jetseo.ir, which returns to /extension/connected;
// POST /extension/token, sent with the site's cookie, then gives this browser a token (the site accepts only
// this extension's id, fixed by the manifest key). CoreApi's api/News endpoints take it in X-JetSEO-User:
// 401 = signed out or revoked, 403 {reason: "no-module"} = no subscription (the free part still works).
// Plain declarations at the top level (no modules): the background loads this with importScripts, the panel with a script tag.

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
  await chrome.storage.local.remove([NEWS_ACCOUNT_KEY, "newsSeen", "newsState", "newsTopicSeen", "newsGapSkip"]);
  chrome.contextMenus.removeAll(() => chrome.runtime.lastError);
  if (account) {
    // revokes the token on the server; signing out here works even if this fails
    fetch("https://coreapi.jetseo.ir/api/Extension/signout", { method: "POST", credentials: "omit", headers: { "X-JetSEO-User": account.token } }).catch(() => {});
  }
}

// An api/News path, GET unless method says POST (the team's marks), with body as its JSON when given (the phrases of
// «کلمات پرجستجو»): { status, data }. status 0 = no network; a 401 forgets the account.
async function newsApi(path, method = "GET", body) {
  const account = await newsAccount();
  if (!account) return { status: 401, data: null };
  try {
    const response = await fetch(`${NEWS_API}/${path}`, {
      method, credentials: "omit",
      headers: { "X-JetSEO-User": account.token, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) await chrome.storage.local.remove(NEWS_ACCOUNT_KEY);
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, data: null };
  }
}

// Counts one use of the foreign stories for JetSEO's own report (api/News/used: opening the list, reading or translating
// an article, the angles; only the action and the category, never the story). Not waited for: a count that fails is lost.
function newsUsed(what, category = "") {
  newsApi(`used?what=${encodeURIComponent(what)}${category ? `&category=${encodeURIComponent(category)}` : ""}`, "POST");
}

// How the toolbar icon opens the app: "tab", a full page (the default), or "panel", Chrome's side panel.
async function newsView() {
  const { newsView: view } = await chrome.storage.sync.get("newsView").catch(() => ({}));
  return view === "panel" ? "panel" : "tab";
}

async function newsSetView(view) {
  await chrome.storage.sync.set({ newsView: view });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: view === "panel" }).catch(() => {});
}

// The full page: brings back the tab already open, or opens one.
async function newsOpenPage() {
  const [page] = await chrome.runtime.getContexts({ contextTypes: ["TAB"] }).catch(() => []);
  if (!page) return chrome.tabs.create({ url: "panel.html?view=tab" });
  await chrome.tabs.update(page.tabId, { active: true });
  await chrome.windows.update(page.windowId, { focused: true });
}

// Personal settings (chrome.storage.sync): excluded and watched words, muted source domains, own topics, notifications.
async function newsPrefs() {
  const { [NEWS_PREFS_KEY]: prefs = {} } = await chrome.storage.sync.get(NEWS_PREFS_KEY).catch(() => ({}));
  return {
    excluded: prefs.excluded ?? [],
    watch: prefs.watch ?? [],
    // «فقط کلیدواژه‌های من»: the lists keep only the stories with a watched word (newsFocused)
    watchOnly: prefs.watchOnly ?? false,
    muted: prefs.muted ?? [],
    topics: prefs.topics ?? [],
    notifyGap: prefs.notifyGap ?? true,
    notifyWatch: prefs.notifyWatch ?? true,
    topicHours: prefs.topicHours ?? 3,
    topicSort: prefs.topicSort ?? "top",
    topicHideOurs: prefs.topicHideOurs ?? false,
    minSources: prefs.minSources ?? 2,
    gapHours: prefs.gapHours ?? 6,
    telegramHours: prefs.telegramHours ?? 6,
    mediaHours: prefs.mediaHours ?? 6,
    globalHours: prefs.globalHours ?? 24,
    globalCategory: prefs.globalCategory ?? "",
    globalSort: prefs.globalSort ?? "top",
    // lists the user switched off in «تنظیمات» (panel.js TAB_NAMES keys)
    hiddenTabs: prefs.hiddenTabs ?? [],
    // off by default: «seen in Persian media» is a match on Latin names only, too weak to hide a story unasked
    globalHideSeen: prefs.globalHideSeen ?? false,
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

// One of the user's own watched words in a headline.
function newsWatched(title, prefs) {
  const folded = newsFold(title);
  return prefs.watch.some((w) => newsMatches(folded, w));
}

// «فقط کلیدواژه‌های من» is on: only with words of the user's own, or every list would be empty.
const newsFocused = (prefs) => !!prefs.watchOnly && prefs.watch.length > 0;

// «رسانه‌های خارجی» stories as the user sees them: watch also for one of the user's own watched words (a Latin one, «openai»,
// matches the English headlines as it is; the server set watch for the team's), and without the stories the team
// dismissed unless showDismissed. The Persian filters (excluded words, topics, muted sources) do not apply.
function newsGlobal(stories, prefs, showDismissed = false) {
  return (stories ?? [])
    .filter((s) => showDismissed || s.mark?.status !== "dismissed")
    .map((s) => (!s.watch && (s.items ?? []).some((i) => newsWatched(i.title, prefs)) ? { ...s, watch: true } : s))
    .filter((s) => !newsFocused(prefs) || s.watch);
}

// The stories the user's own filters leave: none of their words in any headline, none only from muted sources, and of
// their own topics (prefs.topics, a desk of the newsroom; none = all the team shows). A story with a personal watched
// word gets watch, as the team's watched words give it on the server, and a watched story stays whatever its topic
// (the server's rule too). s.topic: CoreApi NewsTopics key or null; a server without topics sends no key: kept.
function newsPersonal(stories, prefs) {
  const muted = new Set(prefs.muted.map((d) => d.toLowerCase()));
  return (stories ?? [])
    .map((s) => ({ ...s, items: (s.items ?? []).filter((i) => !muted.has(String(i.domain).toLowerCase())) }))
    .filter((s) => s.items.length > 0)
    .filter((s) => !s.items.some((i) => prefs.excluded.some((w) => newsMatches(newsFold(i.title), w))))
    .map((s) => (!s.watch && [s.title, ...s.items.map((i) => i.title)].some((t) => newsWatched(t, prefs)) ? { ...s, watch: true } : s))
    .filter((s) => !prefs.topics.length || !("topic" in s) || s.watch || prefs.topics.includes(s.topic))
    // watch: one of the user's own words, or of the team's (set by the server)
    .filter((s) => !newsFocused(prefs) || s.watch);
}

// A list as the text of a CSV file («خروجی»): a BOM so that Excel reads the Persian, CRLF rows, quotes doubled.
// Text that begins with = + - or @ would run as a formula in Excel, and the headlines come from the web: such a cell
// gets a leading apostrophe. Numbers are passed as numbers and stay as they are (a negative lag is «-12»).
function newsCsv(header, rows) {
  const cell = (value) => {
    const s = typeof value === "string" ? value.replace(/^([=+\-@\t\r])/, "'$1") : String(value ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

// Gap stories the user set aside («رد شد»), as `${siteId}:${storyId}`: neither listed nor alerted again.
async function newsSkipped() {
  const { newsGapSkip = [] } = await chrome.storage.local.get("newsGapSkip").catch(() => ({}));
  return new Set(newsGapSkip);
}

async function newsSetSkipped(key, skip) {
  const skipped = await newsSkipped();
  if (skip) skipped.add(key);
  else skipped.delete(key);
  await chrome.storage.local.set({ newsGapSkip: [...skipped].slice(-800) });
}
