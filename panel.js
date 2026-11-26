// «جت‌سئو نیوز» side panel (JetSEO design doc 3-5 and 4): signed out → the jetseo.ir sign-in;
// signed in without the module → Google and Wikipedia trends, the day's occasions and the link to buy; with it → also
// hot stories, the coverage gap of the user's sites, our articles, Telegram and personal settings. Everything comes from
// CoreApi: the filtered sources (Google Trends, Wikipedia, Telegram) are read there through ai.jetseo.ir. Team settings (members, sites, competitors, team filters) are
// in the panel on jetseo.ir. All text from the server goes through esc(); links only through safeUrl().

const main = document.getElementById("main");
const tabsNav = document.getElementById("tabs");
const banner = document.getElementById("banner");
const who = document.getElementById("who");
let state = null;
let tab = "dash";
const FREE_TABS = ["dash", "trends", "wiki", "days"];
let gapSite = null;
let loadId = 0;
// a page to check as «مطالب ما» opens (the right-click «بررسی سئو»)
let pendingCheck = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");

// Story topics from the state (CoreApi NewsTopics): offered = the team's «حوزه خبری» when the owner chose one, else all.
const topicName = (key) => state?.topics?.find((t) => t.key === key)?.name ?? null;
const offeredTopics = () => (state?.topics ?? []).filter((t) => !state.teamTopics?.length || state.teamTopics.includes(t.key));

// Chips of the user's own topics over a story list: «همه» or any of the offered; a click saves and calls redraw.
function topicBar(prefs, redraw) {
  const offered = offeredTopics();
  if (offered.length < 2) return null;
  const bar = document.createElement("div");
  bar.className = "chips topics";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "موضوع‌های من");
  const chip = (key, name) => `<button type="button" class="chip${(key ? prefs.topics.includes(key) : !prefs.topics.length) ? " on" : ""}"
    data-topic="${esc(key)}" aria-pressed="${key ? prefs.topics.includes(key) : !prefs.topics.length}">${esc(name)}</button>`;
  bar.innerHTML = chip("", "همه موضوع‌ها") + offered.map((t) => chip(t.key, t.name)).join("")
    + (state.teamTopics?.length ? `<span class="muted">حوزه تیم</span>` : "");
  bar.onclick = async (e) => {
    const key = e.target.closest("[data-topic]")?.dataset.topic;
    if (key === undefined) return;
    const topics = key ? (prefs.topics.includes(key) ? prefs.topics.filter((k) => k !== key) : [...prefs.topics, key]) : [];
    await saveNewsPrefs({ topics });
    redraw();
  };
  return bar;
}

// «۱۲ دقیقه پیش» from the server's own clock (both times are the server's local time, without a zone)
function ago(at, now) {
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 60000));
  if (!isFinite(minutes)) return "";
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${fa(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${fa(hours)} ساعت پیش` : `${fa(Math.floor(hours / 24))} روز پیش`;
}

// The server's news loop stores headlines every few minutes; none for 90 minutes means it stopped. 2026-11-01: a server
// build without the loop left every story tab empty for days, and «no stories» looked like a quiet news day. Empty when
// the data is fresh, or when CoreApi is older than the updatedAt field.
function staleNote(data) {
  if (!data || !("updatedAt" in data)) return "";
  const minutes = data.updatedAt ? (Date.parse(data.now) - Date.parse(data.updatedAt)) / 60000 : Infinity;
  if (minutes < 90) return "";
  return `<div class="stale">${data.updatedAt ? `آخرین خبر ${ago(data.updatedAt, data.now)} روی سرور ثبت شد` : "هنوز خبری روی سرور ثبت نشده است"}؛
    خواندن خبرها در سرور جت‌سئو متوقف شده و خالی بودن فهرست به معنی نبودن سوژه نیست. لطفاً به پشتیبانی خبر دهید.</div>`;
}

// Signed out, or no state: the export of the last list, the «فقط کلیدواژه‌های من» line and the height held for a redraw go.
function clearList() {
  setExport(null);
  focusBox.hidden = true;
  toldBox.hidden = true;
  main.style.minHeight = "";
}

// A list that did not load. Status 0 is the network (newsApi), and the text says so: «بارگذاری نشد» alone reads as a
// fault of JetSEO's. Such a list is read again by itself once the browser is back online.
const loadFailed = (res, what = "فهرست") => (res.status === 0
  ? `<div class="empty offline">اتصال به جت‌سئو برقرار نیست؛ اینترنت خود را بررسی کنید. با برگشتن اتصال، ${what} خودش دوباره خوانده می‌شود.</div>`
  : `<div class="empty">${what} بارگذاری نشد. کمی بعد ⟳ را بزنید.</div>`);
window.addEventListener("online", () => { if (main.querySelector(".offline")) start(); });

function setBanner(html, bad = false) {
  banner.hidden = !html;
  banner.className = bad ? "bad" : "";
  banner.innerHTML = html ?? "";
}

async function start() {
  const account = await newsAccount();
  if (!account) return signedOut();
  // ⟳ over a list: it stays in sight while the state loads, so show() can keep its place
  if (!main.querySelector(".card")) main.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  const res = await newsApi("state");
  if (res.status === 401) return signedOut();
  if (res.status !== 200) {
    state = null;
    renderNav();
    clearList();
    main.innerHTML = `<div class="center offline"><p>اتصال به جت‌سئو برقرار نشد.${res.status === 0 ? " اینترنت خود را بررسی کنید؛ با برگشتن اتصال، خودش دوباره امتحان می‌کند." : ""}</p><button class="btn ghost" id="retry" type="button">دوباره</button></div>`;
    document.getElementById("retry").onclick = start;
    return;
  }
  state = res.data;
  who.innerHTML = `${esc(state.user?.name)} · <a href="#" id="signout">خروج</a>`;
  document.getElementById("signout").onclick = async (e) => {
    e.preventDefault();
    await newsSignOut();
    signedOut();
  };
  const a = state.access;
  hiddenTabs = (await newsPrefs()).hiddenTabs;
  if (tab !== "settings" && !tabAvailable(tab)) tab = "dash";
  if (!a) {
    const ended = state.endedAt ? "اشتراک جت‌سئو نیوز شما تمام شده است." : "جت‌سئو نیوز برای حساب شما فعال نیست.";
    setBanner(`${ended} ترند گوگل و ویکی‌پدیا و مناسبت‌ها رایگان است؛ سوژه‌های داغ رسانه‌ها، شکاف پوشش و تلگرام با اشتراک. <a href="${safeUrl(state.panelUrl)}" target="_blank" rel="noopener">${state.endedAt ? "تمدید" : "خرید یا ۷ روز رایگان"}</a>`, !!state.endedAt);
  } else if (a.daysLeft <= 7) {
    const text = a.role === "owner"
      ? `${a.trial ? "دوره آزمایشی" : "اشتراک"} شما ${fa(a.daysLeft)} روز دیگر تمام می‌شود. <a href="${safeUrl(state.panelUrl)}" target="_blank" rel="noopener">تمدید</a>`
      : `اشتراک تیم ${fa(a.daysLeft)} روز دیگر تمام می‌شود؛ به ${esc(a.ownerName || "صاحب اشتراک")} برای تمدید خبر دهید.`;
    setBanner(text, a.daysLeft <= 2);
  } else {
    setBanner(null);
  }
  gapSite = gapSite ?? state.sites?.[0]?.id ?? null;
  // own topics the team no longer shows would hide everything: drop them (the background reads the same prefs)
  const prefs = await newsPrefs();
  const keep = prefs.topics.filter((k) => offeredTopics().some((t) => t.key === k));
  if (state.topics && keep.length !== prefs.topics.length) await saveNewsPrefs({ topics: keep });
  showWhatsNew();
  if (!(await takeGo())) show(tab);
}

// Where the background sent the app (a right-click or a notification's click): { tab, siteId, url }, url = a page to
// check. Taken once; false when there is none or its tab needs the module.
async function takeGo() {
  const { newsGo: go } = await chrome.storage.session.get("newsGo").catch(() => ({}));
  if (!go?.tab) return false;
  await chrome.storage.session.remove("newsGo");
  if (!TAB_NAMES[go.tab] || (!state?.access && !FREE_TABS.includes(go.tab)) || (go.tab === "global" && !("foreignNews" in state))) return false;
  let host = "";
  try { host = new URL(go.url).hostname.toLowerCase(); } catch (error) {}
  const site = (state.sites ?? []).find((s) => {
    const d = String(s.domain).toLowerCase().replace(/^www\./, "");
    return s.id === go.siteId || (host && (host === d || host.endsWith(`.${d}`)));
  });
  if (site) gapSite = site.id;
  pendingCheck = go.url ?? null;
  showTold(go);
  show(go.tab);
  return true;
}

// A notification's click: the stories it told, over the list that opens, so they are the first thing in sight and need
// no looking for. Each row is the dashboard's (headline, count, «من می‌نویسم»); it stays until closed or the next click.
// The headlines show at once, as the background told them; the buttons come with refreshTold.
const toldBox = document.getElementById("told");
// the clicked notification's go while its stories are in sight
let toldGo = null;
function showTold(go) {
  toldGo = go?.stories?.length ? go : null;
  toldBox.hidden = !toldGo;
  if (!toldGo) return;
  drawTold(toldGo.stories.map(unmarked));
  toldBox.scrollIntoView({ block: "nearest" });
  refreshTold();
}
// a story as the background saw it, without its mark: no «من می‌نویسم» on it (takeButton)
const unmarked = ({ mark, ...story }) => story;
function drawTold(stories, now) {
  toldBox.innerHTML = `<section class="card"><h3 class="head"><span>اعلان: ${esc(toldGo.title)}</span><a href="#" id="told-close">بستن</a></h3>
    <ul class="need">${stories.map((s) => dashStory(s, `${takenBadge(s, now)}${newsOnOurSite(s) ? `<span class="badge ok">در سایت شما</span>` : ""}`)).join("")}</ul></section>`;
}
// The rows were read when the notification was told, maybe an hour before its click, and api/News/mark overwrites: «من
// می‌نویسم» on a story a colleague took since would take it from them. So a row gets its button only from the story as
// the server has it now, read from the lists the background tells from (background.js poll; the foreign stories have
// ids of their own, so they are looked for only there). A story on none of them any more keeps its headline alone.
async function refreshTold() {
  const go = toldGo;
  if (!go || toldBox.hidden || !state?.access) return;
  const lists = await newsAlertLists(state, await newsPrefs());
  // closed, or another notification clicked, meanwhile; or no answer: the headlines stay as they are
  if (go !== toldGo || !lists) return;
  const stories = go.tab === "global" ? lists.foreign ?? [] : [...lists.gaps, ...lists.watch].flatMap((l) => l.stories ?? []);
  const fresh = new Map(stories.map((s) => [String(s.id), s]));
  drawTold(go.stories.map((s) => fresh.get(String(s.id)) ?? unmarked(s)), lists.now);
}
toldBox.addEventListener("click", (e) => {
  if (!e.target.closest("#told-close")) return;
  e.preventDefault();
  toldGo = null;
  toldBox.hidden = true;
});

function signedOut() {
  state = null;
  // another account may sign in to this panel: it must not see the last one's dashboard
  dashCache.clear();
  renderNav();
  clearList();
  who.textContent = "";
  setBanner(null);
  main.innerHTML = `<div class="center">
    <p>با حساب جت‌سئوی خود وارد شوید. بعد از ورود به همین‌جا برگردید.</p>
    <a class="btn" href="${safeUrl(newsLoginUrl())}" target="_blank" rel="noopener">ورود به جت‌سئو</a>
    <p class="muted" style="margin-top:14px"><a href="#" id="check">وارد شده‌ام؛ دوباره بررسی کن</a></p>
    <p class="muted" id="refused" hidden>این نسخه از اکستنشن را jetseo.ir نمی‌شناسد؛ با پشتیبانی تماس بگیرید.</p>
  </div>`;
  document.getElementById("check").onclick = async (e) => {
    e.preventDefault();
    if (await newsConnect()) return start();
    document.getElementById("refused").hidden = !newsConnect.refused;
  };
}

// The lists, in five sections. In the side panel the top row is the sections and the second the lists of the open one;
// the full page shows them all in one column (renderNav). The second row is hidden when the section has
// one). «تنظیمات» is the header's gear, not a list.
const TAB_NAMES = {
  dash: "داشبورد", topics: "سوژه‌های داغ", gap: "شکاف پوشش", telegram: "تلگرام", media: "چندرسانه‌ای", global: "رسانه‌های خارجی",
  trends: "ترند گوگل", keywords: "کلمات پرجستجو", wiki: "ویکی‌پدیا", days: "مناسبت‌ها", mine: "مطالب ما",
};
const GROUPS = [
  { key: "today", name: "امروز", tabs: ["dash"] },
  { key: "stories", name: "سوژه‌ها", tabs: ["topics", "gap", "telegram", "media", "global"] },
  { key: "trends", name: "ترندها", tabs: ["trends", "wiki", "days"] },
  // a tool the member types into, not a list of trends: a section of its own, one click from anywhere
  { key: "keywords", name: "کلمات پرجستجو", tabs: ["keywords"] },
  { key: "site", name: "سایت ما", tabs: ["mine"] },
];
const subtabsNav = document.getElementById("subtabs");
const settingsButton = document.getElementById("settings");
// the lists the user switched off in «تنظیمات» (prefs.hiddenTabs), read at start
let hiddenTabs = [];
// the list last open in each section, for the click on the section
const lastTab = {};

// A list this account may open now: the free ones without the module, «رسانه‌های خارجی» only when the server knows it
// (a tier without it still gets the list, which says what it is), and none the user switched off.
function tabAvailable(name) {
  if (!state || !TAB_NAMES[name] || hiddenTabs.includes(name)) return false;
  if (!state.access && !FREE_TABS.includes(name)) return false;
  return name !== "global" || "foreignNews" in state;
}

function renderNav() {
  const groups = state ? GROUPS.map((g) => ({ ...g, alone: g.tabs.length === 1, tabs: g.tabs.filter(tabAvailable) })).filter((g) => g.tabs.length) : [];
  const open = groups.find((g) => g.tabs.includes(tab));
  tabsNav.hidden = !groups.length;
  settingsButton.hidden = !state;
  settingsButton.classList.toggle("on", tab === "settings");
  // The full page has the width for every list at once: one column beside the content, the sections as headings, each
  // list one click away. A section of one list is that one button, under the section's name.
  if (pageView === "tab") {
    subtabsNav.hidden = true;
    tabsNav.innerHTML = groups.map((g) => (g.alone ? "" : `<h4>${g.name}</h4>`) + g.tabs.map((t) =>
      `<button type="button" data-tab="${t}" class="${t === tab ? "on" : ""}" aria-pressed="${t === tab}"><span>${g.alone ? g.name : TAB_NAMES[t]}</span>${
        t === "gap" && gapBadge ? `<span class="count" title="شکاف پوشش دیده‌نشده">${fa(gapBadge)}</span>` : ""}</button>`).join("")).join("");
    return;
  }
  tabsNav.innerHTML = groups.map((g) => `<button type="button" data-group="${g.key}" class="${g === open ? "on" : ""}" aria-pressed="${g === open}">${g.name}${
    g.key === "stories" && gapBadge ? ` <span class="count" title="شکاف پوشش دیده‌نشده">${fa(gapBadge)}</span>` : ""}</button>`).join("");
  subtabsNav.hidden = !open || open.tabs.length < 2;
  subtabsNav.innerHTML = open ? open.tabs.map((t) => `<button type="button" data-tab="${t}" class="${t === tab ? "on" : ""}" aria-pressed="${t === tab}">${TAB_NAMES[t]}${
    t === "gap" && gapBadge ? ` <span class="count">${fa(gapBadge)}</span>` : ""}</button>`).join("") : "";
}

// the unseen coverage gaps from the background's last round (the icon's number), until «شکاف پوشش» is opened
let gapBadge = 0;

function show(name) {
  // The same list drawn again («من می‌نویسم», a filter, ⟳, the 3-minute refresh): it stays where the user was reading,
  // with the «جزئیات» they had opened. main keeps its height while the list loads, so the page does not jump to the top.
  const keep = name === tab && name !== "settings" && main.querySelector(".card")
    ? { open: new Set([...main.querySelectorAll("details.more[open]")].map((d) => d.closest(".card")?.querySelector("h3")?.textContent)),
      // the card the keyboard is on (J/K, then W draws the list again): its headline gets the focus back
      focus: document.activeElement?.closest?.("#main article.card")?.querySelector("h3")?.textContent }
    : null;
  main.style.minHeight = keep ? `${main.offsetHeight}px` : "";
  tab = name;
  const group = GROUPS.find((g) => g.tabs.includes(name));
  if (group) lastTab[group.key] = name;
  if (name === "gap") gapBadge = 0;
  renderNav();
  // for JetSEO's use report: which module tabs a member opens (once a half hour each; «رسانه‌های خارجی» counts itself, by category)
  if (state?.access && PERSIAN_TABS.includes(name)) countOnce(`${name}-open`);
  const id = ++loadId;
  renderFocus(name);
  // the list that opens says what it has to save, once it has drawn its rows
  setExport(null);
  const drawn = ({ dash: showDash, topics: showTopics, gap: showGap, global: showGlobal, mine: showMine, trends: showTrends, keywords: showKeywords, wiki: showWiki, days: showDays, telegram: showTelegram, media: showMedia, settings: showSettings })[name](id);
  if (keep) Promise.resolve(drawn).catch(() => {}).then(() => {
    if (id !== loadId) return;
    for (const d of main.querySelectorAll("details.more")) if (keep.open.has(d.closest(".card")?.querySelector("h3")?.textContent)) d.open = true;
    if (keep.focus) [...main.querySelectorAll("article.card h3")].find((h) => h.textContent === keep.focus)?.querySelector("a")?.focus({ preventScroll: true });
    main.style.minHeight = "";
  });
}

// «فقط کلیدواژه‌های من» (prefs.watchOnly, set in «تنظیمات»): the story lists keep only the stories with a watched word
// (api.js newsFocused). Over each of those lists a line says so, with the words and the way back: a list that is short
// or empty for no reason in sight reads as «no news».
const FOCUS_TABS = ["dash", "topics", "gap", "telegram", "media", "global"];
const focusBox = document.getElementById("focus");
// While it is on, an empty list is empty because of the words, whatever the list's own reason would be.
const emptyText = (prefs, text) => (newsFocused(prefs) ? "در این بازه سوژه‌ای با کلیدواژه‌های شما نیست." : text);
// While it is on, «سوژه‌های داغ» also lists what one site alone told: a followed subject is seldom a story of many sites.
const topicMinSources = (prefs) => (newsFocused(prefs) ? 1 : prefs.minSources);
async function renderFocus(name) {
  const prefs = await newsPrefs();
  if (name !== tab) return;
  focusBox.hidden = !(state?.access && FOCUS_TABS.includes(name) && newsFocused(prefs));
  if (focusBox.hidden) return;
  focusBox.innerHTML = `فقط سوژه‌های کلیدواژه‌های شما: <b>${esc(prefs.watch.slice(0, 6).join("، "))}${prefs.watch.length > 6 ? ` و ${fa(prefs.watch.length - 6)} کلمه دیگر` : ""}</b>
    · <a href="#" id="focus-off">نمایش همه سوژه‌ها</a> · <a href="#" id="focus-edit">ویرایش کلمه‌ها</a>`;
  document.getElementById("focus-off").onclick = async (e) => { e.preventDefault(); await saveNewsPrefs({ watchOnly: false }); show(tab); tabsNav.querySelector("button.on")?.focus(); };
  document.getElementById("focus-edit").onclick = (e) => { e.preventDefault(); show("settings"); };
}

// «خروجی» (the header's «⬇ اکسل»): the list on screen as a CSV file, UTF-8 with a BOM so that Excel reads the Persian. Each
// list calls setExport with the rows it shows (after its filters and order); the button is there only while it has any.
const exportButton = document.getElementById("export");
let exportData = null;
function setExport(name, header, rows) {
  exportData = rows?.length ? { name, header, rows } : null;
  exportButton.hidden = !exportData;
}
exportButton.onclick = () => {
  if (!exportData) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([newsCsv(exportData.header, exportData.rows)], { type: "text/csv;charset=utf-8" }));
  a.download = `jetseo-news-${exportData.name.replace(/[\\/:*?"<>|\s]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// the server's local time, «2026-11-23T10:12:00», as a spreadsheet reads it
const csvTime = (at) => String(at ?? "").replace("T", " ").slice(0, 16);
// «کلیدواژه: تولید»: the watched word that marked a story or post (s.watchWord: the server's for the team's words, api.js
// newsWithWatch for the user's own); an older server sends none
const watchText = (s) => (s.watchWord ? `کلیدواژه: ${s.watchWord}` : "کلیدواژه تحت نظر");
const watchBadge = (s) => `<span class="badge watch" title="کلیدواژه تحت نظر">${esc(watchText(s))}</span>`;
// A Persian story as a row; `more` = the columns of the list it is in (a gap's competitors, the media made for it).
const STORY_HEADER = ["تیتر", "تعداد سایت", "تعداد کانال تلگرام", "اولین منبع", "اولین انتشار", "موضوع", "برچسب‌ها", "لینک", "منابع"];
const storyRow = (s, more = []) => [
  s.title, s.sources ?? 0, s.channels ?? 0, s.firstSource ?? "", csvTime(s.firstAt), topicName(s.topic) ?? "",
  [s.watch ? watchText(s) : "", s.ours ? "در سایت شما" : "", s.mark?.status === "taken" ? `می‌نویسد: ${s.mark.by || "یکی از اعضا"}` : "",
    s.telegramLead > 0 ? "اول در تلگرام" : "", s.trend ? `ترند ${s.trend.source}: ${s.trend.text}` : ""].filter(Boolean).join("، "),
  s.items?.[0]?.url ?? "", (s.items ?? []).map((i) => i.source).join("، "), ...more,
];

tabsNav.addEventListener("click", (e) => {
  // the full page's column has the lists themselves
  const list = e.target.closest("button[data-tab]");
  if (list) return show(list.dataset.tab);
  const group = GROUPS.find((g) => g.key === e.target.closest("button[data-group]")?.dataset.group);
  if (!group) return;
  const open = group.tabs.filter(tabAvailable);
  show(open.includes(lastTab[group.key]) ? lastTab[group.key] : open[0]);
});
subtabsNav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) show(b.dataset.tab);
});
settingsButton.onclick = () => show("settings");
document.getElementById("refresh").onclick = () => start();

// This page is the full-page view (opened as panel.html?view=tab) or the side panel. The header switch moves to the
// other view and keeps it as the icon's default.
const pageView = new URLSearchParams(location.search).get("view") === "tab" ? "tab" : "panel";
document.body.classList.toggle("page", pageView === "tab");
tabsNav.classList.toggle("side", pageView === "tab");
for (const b of document.querySelectorAll("#view button")) {
  b.classList.toggle("on", b.dataset.view === pageView);
  b.setAttribute("aria-pressed", b.dataset.view === pageView);
}
let windowId = null;
chrome.windows.getCurrent().then((w) => { windowId = w.id; });
document.getElementById("view").onclick = async (e) => {
  const view = e.target.closest("button[data-view]")?.dataset.view;
  if (!view || view === pageView) return;
  if (view === "panel") {
    // sidePanel.open needs the click's user gesture: called before anything is awaited
    const opened = chrome.sidePanel.open({ windowId }).then(() => true, () => false);
    await newsSetView("panel");
    // this tab closes only once the panel is there, so a failed open does not leave the user with nothing
    const self = await chrome.tabs.getCurrent();
    if (self && (await opened)) chrome.tabs.remove(self.id);
  } else {
    await newsSetView("tab");
    await newsOpenPage();
    window.close();
  }
};

// s.trend: the Google trend or rising Wikipedia article in its headlines; s.channels: Telegram channels that told it
// (s.sources counts sites); s.telegramLead: minutes the first channel was ahead of the first site. All from the server.
// s.fresh: not on the list the last time it was in sight (markFresh). body: shown under the meta line, before the headlines.
// s.mark, s.ours, s.recent: the team's «من می‌نویسم», a story one of its own sites tells, and the sources that joined in the
// last risingMinutes (the server's News.RisingMinutes, kept from the last list). A server without them sends none: the
// card then shows neither the badges nor the «من می‌نویسم» button.
let risingMinutes = 60;
// ---------------------------------------------------------------- shared by every list

// «من می‌نویسم», «رد برای تیم» and their undo on a story: the team's mark (api/News/mark), then the list again, as every
// member now sees it.
async function onMark(e) {
  const b = e.target.closest("button[data-mark]");
  if (!b) return;
  b.disabled = true;
  const res = await newsApi(`mark?storyId=${encodeURIComponent(b.dataset.story)}&status=${encodeURIComponent(b.dataset.mark)}`, "POST");
  if (res.status === 200) {
    // the notification's stories show the new mark too, wherever it was set
    refreshTold();
    return show(tab);
  }
  b.disabled = false;
  b.textContent = "ذخیره نشد";
}
main.addEventListener("click", onMark);
toldBox.addEventListener("click", onMark);

// The keyboard on a list of cards: J and K go to the next and the last card (its headline gets the focus, so Enter opens
// the article), W is the card's «من می‌نویسم» or «منصرف شدم», and / goes to the list's search box. By the key's place
// on the keyboard (code), not its letter: with the Persian layout on, J types «ت».
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target.closest?.("input, textarea, select")) return;
  const cards = [...main.querySelectorAll("article.card:not([hidden])")];
  const at = cards.indexOf(document.activeElement?.closest?.("article.card"));
  if (e.code === "KeyJ" || e.code === "KeyK") {
    const card = cards[e.code === "KeyJ" ? Math.min(at + 1, cards.length - 1) : Math.max(at - 1, 0)];
    const link = card?.querySelector("h3 a, button");
    if (!link) return;
    e.preventDefault();
    link.focus();
    card.scrollIntoView({ block: "nearest" });
  } else if (e.code === "KeyW" && at >= 0) {
    cards[at].querySelector("button[data-take]")?.click();
  } else if (e.code === "Slash") {
    const search = main.querySelector("input[type=search]");
    if (!search) return;
    e.preventDefault();
    search.focus();
  }
});

// for JetSEO's use report (newsUsed): the category on screen, and when the open was last counted (one a half hour:
// every filter change and mark draws the list again)
let globalCategory = "";
const counted = {};
function countOnce(what, category = "") {
  const key = `${what}|${category}`;
  if (Date.now() - (counted[key] ?? 0) < 30 * 60 * 1000) return;
  counted[key] = Date.now();
  newsUsed(what, category);
}

const PERSIAN_TABS = ["topics", "gap", "mine", "telegram", "media"];

// a foreign article opened or sent to Google Translate from a «رسانه‌های خارجی» card (the Persian headlines found are
// not counted), or a headline opened from a card of the Persian module tabs
main.addEventListener("click", (e) => {
  const a = e.target.closest(".card a[href]");
  if (!a || !/^https?:/.test(a.href)) return;
  if (a.closest(".global")) {
    if (!a.closest("ul[lang=fa]")) newsUsed(a.href.startsWith("https://translate.google.com/") ? "translate" : "read", globalCategory);
  } else if (PERSIAN_TABS.includes(tab)) {
    newsUsed("persian-read");
  }
});

// The controls of a list: `primary` always in sight (the period and the order), the rest behind «فیلتر», whose number
// says how many of them are on. The panel stays open across the list's redraws (a change of a filter draws it again).
// «بازه»: one period for the Persian story lists (hot stories, coverage gap, Telegram, multimedia) and the dashboard:
// chosen on any of them, kept for all (prefs.hours; the server takes 1 to 24). «رسانه‌های خارجی» keeps its own, up to 72.
const hoursHtml = (prefs) => `<label title="برای همه فهرست‌های سوژه و داشبورد یکی است">بازه <select id="hours">${[1, 3, 6, 12, 24].map((h) => `<option value="${h}" ${h === prefs.hours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>`;
const wireHours = (name) => { document.getElementById("hours").onchange = async (e) => { await saveNewsPrefs({ hours: +e.target.value }); show(name); }; };

const filtersOpen = {};
function controlsHtml(primary, filters = "", active = 0) {
  const open = !!filtersOpen[tab];
  return `<div class="controls">${primary}${filters ? `<button id="ftoggle" class="btn ghost small" type="button" aria-expanded="${open}" aria-controls="fpanel">فیلتر${active ? ` <span class="count">${fa(active)}</span>` : ""}</button>` : ""}</div>
    ${filters ? `<div id="fpanel" class="controls filters"${open ? "" : " hidden"}>${filters}</div>` : ""}`;
}
function wireControls() {
  const toggle = document.getElementById("ftoggle");
  if (!toggle) return;
  toggle.onclick = () => {
    filtersOpen[tab] = !filtersOpen[tab];
    document.getElementById("fpanel").hidden = !filtersOpen[tab];
    toggle.setAttribute("aria-expanded", String(filtersOpen[tab]));
  };
}

// One layout for every story card (Persian and foreign), so a list reads at a glance:
//   the headline, a link to the first source's article (ltr: an English headline);
//   the count badge, then at most two of `badges` (most important first; the rest go under «جزئیات»);
//   `meta` (more of the line: who told it first), then the main button and the other actions (`menu`), all in sight.
// badges, meta, main and menu are HTML already escaped by the caller.
function cardShell({ title, url, ltr = false, count, badges = [], meta = "", main: mainButton = "", menu = [], body = "", details = "", className = "" }) {
  const shown = badges.filter(Boolean);
  return `<article class="card ${className}">
    <h3${ltr ? ` dir="ltr" lang="en"` : ""}>${url ? `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title)}</h3>
    <div class="meta">
      ${count}
      ${shown.slice(0, 2).join("")}
      ${meta}
      <span class="acts">${mainButton}${menu.filter(Boolean).join("")}</span>
    </div>
    ${body}
    <div class="angles"></div>
    <details class="more"><summary>جزئیات</summary>${shown.length > 2 ? `<div class="meta">${shown.slice(2).join("")}</div>` : ""}${details}</details>
  </article>`;
}

// the team's «من می‌نویسم» on a story (s.mark from the server; a server without marks sends none, and no button shows)
const takeButton = (s) => ("mark" in s
  ? `<button class="btn ghost small" type="button" data-take data-mark="${s.mark?.status === "taken" ? "none" : "taken"}" data-story="${esc(s.id)}" title="${s.mark?.status === "taken" ? "سوژه برای تیم آزاد می‌شود" : "به تیم می‌گوید شما روی این سوژه کار می‌کنید"}">${s.mark?.status === "taken" ? "منصرف شدم" : "من می‌نویسم"}</button>`
  : "");
const takenBadge = (s, now) => (s.mark?.status === "taken"
  ? `<span class="badge tg" title="یکی از اعضای تیم روی این سوژه کار می‌کند">می‌نویسد: ${esc(s.mark.by || "یکی از اعضا")} · ${ago(s.mark.at, now)}</span>` : "");

// A Persian story. extra: { meta, menu, body } of the list it is in (the competitors and «رد شد» of a gap, the media of «چندرسانه‌ای»).
function storyCard(s, now, extra = {}) {
  const items = (s.items ?? []).map((i) =>
    `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${i.telegram ? "تلگرام · " : ""}${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("");
  return cardShell({
    title: s.title, url: s.items?.[0]?.url, className: s.fresh ? "fresh" : "",
    count: s.sources ? `<span class="badge">${fa(s.sources)} منبع</span>` : s.channels ? `<span class="badge">${fa(s.channels)} کانال</span>` : "",
    badges: [
      takenBadge(s, now),
      s.watch ? watchBadge(s) : "",
      s.ours ? `<span class="badge ok" title="یکی از سایت‌های تیم این سوژه را منتشر کرده است">در سایت شما</span>` : "",
      s.recent >= 2 ? `<span class="badge new" title="منابعی که در ${fa(risingMinutes)} دقیقه اخیر این سوژه را زده‌اند">${fa(s.recent)} منبع تازه</span>` : "",
      s.fresh ? `<span class="badge new">جدید</span>` : "",
      s.telegramLead > 0 ? `<span class="badge tg">اول در تلگرام · ${duration(s.telegramLead)} زودتر</span>` : "",
      s.trend ? `<span class="badge trend">ترند ${esc(s.trend.source)}: ${esc(s.trend.text)}</span>` : "",
      s.sources && s.channels ? `<span class="badge">${fa(s.channels)} کانال</span>` : "",
      topicName(s.topic) ? `<span class="badge topic">${esc(topicName(s.topic))}</span>` : "",
    ],
    meta: `<span>اولین: ${esc(s.firstSource)} · ${ago(s.firstAt, now)}</span>${extra.meta ?? ""}`,
    main: takeButton(s),
    menu: [
      `<button class="btn ghost small" type="button" data-angles="${esc(s.trend?.text ?? s.title)}" title="آنچه مخاطب همراه این سوژه جستجو می‌کند">مردم چه می‌پرسند؟</button>`,
      promptButton(s, s.ours ? "update" : s.competitors?.length ? "gap" : "new"),
      extra.menu,
    ],
    body: extra.body ?? "",
    details: `<div class="sub">تیترها (${fa(s.items?.length ?? 0)})</div><ul>${items}</ul>`,
  });
}

// «جدید» on the stories not on the list the last time it was in sight: what a hidden page renders (the 3-minute
// refresh) stays new until it is seen. The first time, the list is the baseline.
async function markFresh(stories) {
  const { newsTopicSeen: seen } = await chrome.storage.local.get("newsTopicSeen").catch(() => ({}));
  const known = new Set(seen ?? stories.map((s) => String(s.id)));
  const fresh = stories.filter((s) => !known.has(String(s.id)));
  if (!seen || !document.hidden) await chrome.storage.local.set({ newsTopicSeen: [...known, ...fresh.map((s) => String(s.id))].slice(-800) });
  return stories.map((s) => (fresh.includes(s) ? { ...s, fresh: true } : s));
}

// «داشبورد»: one look at everything, from the same endpoints as the tabs (the module ones only with access). Each part
// shows on its own, so a source that fails does not hide the rest; its tile shows «—». Tiles and «همه» open the tab.
// The cards are drawn at once and each fills when its own answer comes (draw runs again per answer, and patch touches
// only the cards that changed), so the slowest source holds back its own card only.
// the dashboard's last answers by path, for this panel's lifetime: coming back to it draws them at once, then the fresh ones
const dashCache = new Map();
// a card or a number whose answer is not here yet
const SKELETON = `<div aria-busy="true"><i class="skel"></i><i class="skel"></i><i class="skel"></i></div>`;
// a section's «همه» tab → the answer it waits for
const DASH_WAITS = { topics: "topics", gap: "gap", mine: "mine", global: "foreign", trends: "google", wiki: "wiki", days: "days" };
async function showDash(id) {
  const prefs = await newsPrefs();
  const a = state?.access;
  const sites = state?.sites ?? [];
  const pick = (ok) => sites.find((s) => s.id === gapSite && ok(s)) ?? sites.find(ok);
  const gapS = pick((s) => s.hasFeed && s.competitors);
  const mineS = pick((s) => s.hasFeed);
  const skipped = await newsSkipped();
  const account = await newsAccount();
  // after the last await: a list opened meanwhile must not be drawn over
  if (id !== loadId) return;
  if (!account) return signedOut();
  // a list switched off in the settings is not asked for
  const paths = {
    topics: a && tabAvailable("topics") && `topics?hours=${prefs.hours}&minSources=${topicMinSources(prefs)}`,
    gap: a && tabAvailable("gap") && gapS && `gap?siteId=${gapS.id}&hours=${prefs.hours}`,
    tg: a && tabAvailable("telegram") && `telegram?mode=only&hours=${prefs.hours}`,
    mine: a && tabAvailable("mine") && mineS && `mine?siteId=${mineS.id}&hours=24`,
    foreign: a && tabAvailable("global") && state.foreignNews && `foreign?hours=${prefs.globalHours}`,
    google: "google", wiki: "wiki?mode=rising", days: "days?offset=0",
  };
  // the answers by name. undefined: asked and not here yet (and no last answer); null: not asked, or it failed
  const d = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, path ? dashCache.get(path) : null]));
  const wait = (...names) => names.some((name) => d[name] === undefined);
  // a section that waits for its answer is drawn as a skeleton; one without a «همه» tab, or with skeleton false, is not
  const section = (title, go, body, skeleton = true) => dashSection(title, go, body || (skeleton && go && wait(DASH_WAITS[go]) && SKELETON));
  const draw = () => {
  const { topics, gap, tg, mine, foreign, google, wiki, days } = d;
  const hot = topics ? newsPersonal(topics.stories, prefs) : null;
  const gaps = gap ? newsPersonal(gap.stories, prefs).filter((s) => !skipped.has(`${gapS.id}:${s.id}`)) : null;
  const tgOnly = tg ? newsPersonal(tg.stories, prefs) : null;
  const global = foreign ? newsGlobal(foreign.stories, prefs) : null;
  const trends = google?.trends ?? null;
  const rising = wiki ? (wiki.items ?? []).filter((x) => x.base > 0).map((x) => ({ ...x, ratio: x.views / x.base })).sort((x, y) => y.ratio - x.ratio) : null;
  const round = days ? (days.entries ?? []).filter((e) => e.ago % 5 === 0) : null;
  const mineItems = mine?.items ?? [];
  const first = mineItems.filter((i) => i.lagMinutes != null && i.lagMinutes <= 0).length;
  const late = mineItems.filter((i) => i.lagMinutes > 0);
  const none = mineItems.length - first - late.length;
  const dots = `<i class="skel n"></i>`;
  const count = (list, name) => (list ? fa(list.length) : wait(name) ? dots : "—");

  // «الان باید دید»: the stories that wait for someone, the most pressing first, each once and with why it is here: a
  // watched word, then what the competitors told, then what is heating up. Not those a team's site has or a member took.
  const now = topics?.now ?? gap?.now ?? tg?.now;
  risingMinutes = topics?.risingMinutes ?? risingMinutes;
  const need = [], needStories = [], needIds = new Set();
  const addNeed = (list, ok, badges) => (list || []).forEach((s) => {
    // any mark: taken, or dismissed for the team («رد شد» on its gap card)
    if (needIds.has(s.id) || s.ours || s.mark || !ok(s)) return;
    needIds.add(s.id);
    need.push(dashStory(s, badges(s)));
    needStories.push(s);
  });
  addNeed(hot, (s) => s.watch, watchBadge);
  addNeed(tgOnly, (s) => s.watch, (s) => `${watchBadge(s)}<span class="badge tg">فقط در تلگرام</span>`);
  addNeed(gaps, () => true, (s) => `<span class="badge late">رقبا زده‌اند: ${esc((s.competitors ?? []).join("، "))}</span>`);
  addNeed(hot && [...hot].sort((x, y) => (y.recent ?? 0) - (x.recent ?? 0)), (s) => s.recent >= 2,
    (s) => `<span class="badge new">${fa(s.recent)} منبع تازه</span>`);
  // «تیم الان چه می‌نویسد»: the stories a member took, on any list, so nobody starts one twice. The foreign stories
  // have ids of their own, so they are not folded in with the Persian ones.
  const taken = [...new Map([...(hot || []), ...(gaps || []), ...(tgOnly || [])].map((s) => [s.id, s])).values(), ...(global || [])]
    .filter((s) => s.mark?.status === "taken");
  // «معطل»: taken that long ago and still on none of the team's sites; those first, the longest wait on top
  const waited = (s) => Math.max(0, Math.round((Date.parse(now) - Date.parse(s.mark.at)) / 60000)) || 0;
  const stalled = (s) => !newsOnOurSite(s) && waited(s) >= STALLED_MINUTES;
  taken.sort((x, y) => stalled(y) - stalled(x) || waited(y) - waited(x));
  const stalledCount = taken.filter(stalled).length;
  // «پوشش به تفکیک میز»: of each topic's hot stories, how many a team's site has; the desk furthest behind first
  const desks = hot && mineS ? Object.values(hot.reduce((d, s) => {
    const name = topicName(s.topic) ?? "سایر";
    d[name] ??= { name, all: 0, ours: 0, missing: [] };
    d[name].all++;
    if (s.ours) d[name].ours++;
    else d[name].missing.push(s);
    return d;
  }, {})).sort((x, y) => (y.all - y.ours) - (x.all - x.ours) || y.all - x.all) : [];
  // how much of what the media tell the team's sites have, and how much is heating up now
  const covered = hot ? hot.filter((s) => s.ours).length : 0;
  const heating = hot ? hot.filter((s) => s.recent >= 2) : null;

  // «جا مانده‌ها»: the three lists that answer «what did I miss?», as one block: what the competitors told, what the
  // foreign media told, and what only Telegram channels told so far. A list switched off in the settings has no tile.
  const on = (name) => tabAvailable(name);
  const missed = a ? [
    // not set up yet (no site, feed or competitors): the tile says so and opens the three steps
    on("gap") ? (gapS ? tile("gap", count(gaps, "gap"), "رقبا زده‌اند، شما نه", gaps?.length ? "bad" : wait("gap") || newsFocused(prefs) ? "" : "ok") : tile("gap", "؟", "شکاف پوشش تنظیم نشده؛ راه‌اندازی")) : "",
    on("global") && state.foreignNews ? tile("global", count(global, "foreign"), `رسانه‌های خارجی (${fa(prefs.globalHours)} ساعت)`) : "",
    on("telegram") ? tile("telegram", count(tgOnly, "tg"), "فقط در تلگرام") : "",
  ].join("") : "";
  const tiles = (a ? [
    // without a site that has a feed nothing can be «در سایت شما»: the plain count then
    on("topics") ? (hot?.length && mineS
      ? tile("topics", `${fa(covered)} از ${fa(hot.length)}`, `سوژه داغ را زده‌اید (${fa(prefs.hours)} ساعت)`)
      : tile("topics", count(hot, "topics"), `سوژه داغ (${fa(prefs.hours)} ساعت)`)) : "",
    on("topics") ? tile("topics", count(heating, "topics"), `رو به رشد (${fa(risingMinutes)} دقیقه اخیر)`) : "",
    on("mine") ? tile("mine", mine && first + late.length ? `${fa(Math.round((100 * first) / (first + late.length)))}٪` : wait("mine") ? dots : "—", "اول منتشر کردید") : "",
  ] : []).concat([
    tile("trends", count(trends, "google"), "ترند گوگل"),
    tile("wiki", count(rising, "wiki"), "ویکی رو به رشد"),
    tile("days", count(round, "days"), "سالگرد رُند امروز"),
  ]).join("");

  // «مقایسه با رسانه‌های دیگر»: the sites by how many of the hot stories each told and how many it told first
  // (api.js newsMediaRank). The 8 that told most, and the team's own row wherever it stands.
  const rank = hot?.length ? newsMediaRank(hot, sites.filter((s) => s.hasFeed).map((s) => s.domain)) : null;
  const rankShown = rank ? rank.rows.map((r, n) => ({ ...r, place: n + 1 })).filter((r) => r.place <= 8 || r.ours) : [];
  const firstText = (r) => (r.first == null ? "" : ` · ${fa(r.first)} بار اول`);
  // a medium's row opens the stories it told and the team's sites did not (the same <details> as the desks' rows)
  const rankHtml = rankShown.length > 1 && `<div class="bars">${rankShown.map((r) => {
    const row = `<span class="bar-label">${fa(r.place)}. ${r.ours ? "شما" : esc(r.name)}</span><span class="bar"><i style="width:${Math.max(4, Math.round((100 * r.covered) / hot.length))}%"></i></span>
      <span class="bar-val"${r.first == null ? ` title="خبرهای سایت شما در فهرست منابع سوژه‌ها نیست؛ سرعت شما در «سرعت انتشار ما» آمده است"` : ""}>${fa(r.covered)} از ${fa(hot.length)}${firstText(r)}</span>`;
    const missing = r.ours ? [] : r.stories.filter((s) => !s.ours);
    const key = `rank:${r.name}`;
    return missing.length ? `<details class="desk" data-desk="${esc(key)}"${openDesks.has(key) ? " open" : ""}>
      <summary class="bar-row" title="${fa(missing.length)} سوژه که این رسانه زده و شما نه">${row}</summary>
      <ul class="need">${missing.map((s) => dashStory(s, s.mark?.status === "taken" ? takenBadge(s, now) : "")).join("")}</ul></details>`
      : `<div class="bar-row${r.ours ? " ours" : ""}">${row}</div>`;
  }).join("")}</div>
    <p class="muted" style="margin:4px 0 0">از ${fa(hot.length)} سوژه داغ این بازه: چند تا را پوشش داده و چند بار اولین سایت بوده است.${
      rank.cut ? ` در ${fa(rank.cut)} سوژه پرمنبع فقط ۱۲ سایت اول شمرده شده‌اند.` : ""}</p>`;

  const median = late.length ? late.map((i) => i.lagMinutes).sort((x, y) => x - y)[Math.floor(late.length / 2)] : 0;
  const speed = mineItems.length ? `<div class="stack"><i class="s-ok" style="flex:${first}"></i><i class="s-late" style="flex:${late.length}"></i><i class="s-none" style="flex:${none}"></i></div>
    <div class="legend"><span><i class="s-ok"></i>اول شما ${fa(first)}</span><span><i class="s-late"></i>بعد از رقبا ${fa(late.length)}</span><span><i class="s-none"></i>رقیبی نزده ${fa(none)}</span></div>
    ${late.length ? `<p class="muted" style="margin:4px 0 0">تأخیر میانه: ${duration(median)}</p>` : ""}` : "";

  // «کپی گزارش شیفت»: the dashboard as text for the newsroom's group, what an editor hands over at the end of a shift
  // not while an answer is still on its way: half a report would be copied
  const report = a && !wait(...Object.keys(d)) ? [
    `گزارش جت‌سئو نیوز${mineS ? ` · ${mineS.domain}` : ""} · ${new Date(now ?? Date.now()).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}`,
    hot?.length && mineS ? `پوشش سوژه‌های داغ (${fa(prefs.hours)} ساعت اخیر): ${fa(covered)} از ${fa(hot.length)} (${fa(Math.round((100 * covered) / hot.length))}٪)` : "",
    desks.length > 1 ? `به تفکیک میز: ${desks.map((d) => `${d.name} ${fa(d.ours)} از ${fa(d.all)}`).join("، ")}` : "",
    rankShown.length > 1 ? `رتبه پوشش بین رسانه‌ها: ${rankShown.map((r) => `${fa(r.place)}. ${r.ours ? "ما" : r.name} (${fa(r.covered)}${firstText(r)})`).join("، ")}` : "",
    gaps ? `شکاف پوشش باز:${fa(gaps.length)}${gaps.slice(0, 5).map((s) => `\n- ${s.title} (رقبا: ${(s.competitors ?? []).join("، ")})`).join("")}` : "",
    first + late.length ? `سرعت انتشار (۲۴ ساعت): اول ما ${fa(first)}، بعد از رقبا ${fa(late.length)}${late.length ? `، تأخیر میانه ${duration(median)}` : ""}` : "",
    taken.length ? `در دست تیم:${taken.map((s) => `\n- ${s.mark.by || "یکی از اعضا"}: ${s.title}${newsOnOurSite(s) ? " (منتشر شد)" : stalled(s) ? ` (${duration(waited(s))}، هنوز منتشر نشده)` : ""}`).join("")}` : "",
    needStories.length ? `بی‌صاحب (${fa(needStories.length)}):${needStories.slice(0, 5).map((s) => `\n- ${s.title}`).join("")}` : "",
  ].filter(Boolean).join("\n") : "";

  // «⬇ اکسل» on the dashboard: its numbers and lists as one sheet, a block per «بخش». The media ranking is whole here,
  // not only the 8 rows of the card. Numbers go as numbers, so Excel can sort and sum them.
  const sheet = [];
  const add = (part, title, value, note = "", link = "") => sheet.push([part, title, value ?? "", note, link]);
  if (hot) add("خلاصه", `سوژه داغ (${prefs.hours} ساعت)`, hot.length);
  if (hot && mineS) add("خلاصه", "سوژه داغی که زده‌ایم", covered, `از ${hot.length}`);
  if (heating) add("خلاصه", "سوژه رو به رشد", heating.length);
  if (gaps) add("خلاصه", "شکاف پوشش باز", gaps.length, gapS.domain);
  if (tgOnly) add("خلاصه", "فقط در تلگرام", tgOnly.length);
  if (global) add("خلاصه", `سوژه رسانه‌های خارجی (${prefs.globalHours} ساعت)`, global.length);
  if (first + late.length) {
    add("سرعت انتشار (۲۴ ساعت)", "اول ما", first);
    add("سرعت انتشار (۲۴ ساعت)", "بعد از رقبا", late.length, late.length ? `تأخیر میانه ${duration(median)}` : "");
    add("سرعت انتشار (۲۴ ساعت)", "رقیبی نزده", none);
  }
  (rank?.rows ?? []).forEach((r, n) => add("مقایسه با رسانه‌های دیگر", r.ours ? "ما" : r.name, r.covered, `رتبه ${n + 1} · از ${hot.length} سوژه${r.first == null ? "" : ` · ${r.first} بار اول`}`));
  if (desks.length > 1) desks.forEach((d) => add("پوشش به تفکیک میز", d.name, d.ours, `از ${d.all}`));
  needStories.forEach((s) => add("الان باید دید", s.title, s.sources || s.channels || "", s.firstSource ?? "", s.items?.[0]?.url ?? ""));
  taken.forEach((s) => add("تیم الان چه می‌نویسد", s.title, s.mark.by || "یکی از اعضا", newsOnOurSite(s) ? "منتشر شد" : stalled(s) ? `${duration(waited(s))}، هنوز منتشر نشده` : "", s.items?.[0]?.url ?? ""));
  (gaps ?? []).forEach((s) => add("شکاف پوشش", s.title, s.sources ?? "", `رقبا: ${(s.competitors ?? []).join("، ")}`, s.items?.[0]?.url ?? ""));
  (trends ?? []).forEach((t) => add("ترند گوگل", t.title, t.traffic ?? ""));
  setExport("داشبورد", ["بخش", "عنوان", "مقدار", "توضیح", "لینک"], sheet);

  patch(main, staleNote(topics)
    + (missed ? `<section class="card missed"><h3>جا مانده‌ها</h3><div class="tiles">${missed}</div></section>` : "")
    + `<div class="tiles">${tiles}</div>`
    + (report ? `<p class="dash-acts"><button class="btn ghost small" type="button" data-copy="${esc(report)}" title="وضعیت همین لحظه (پوشش، میزها، شکاف‌ها، سرعت انتشار، کار اعضا) به صورت متن کپی می‌شود تا در گروه تحریریه بگذارید">کپی گزارش شیفت</button></p>` : "")
    + `<div class="dash-grid"></div>`);
  patch(main.querySelector(".dash-grid"),
    // «nothing waits» is said only once all three lists are here
    section(`الان باید دید${need.length ? ` (${fa(need.length)})` : ""}`, "topics", need.length ? `<ul class="need">${need.slice(0, 6).join("")}</ul>`
      : wait("topics", "gap", "tg") ? SKELETON
      : (hot || gaps) && `<p class="muted" style="margin:0">سوژه‌ای منتظر شما نیست: نه کلیدواژه تحت نظر، نه شکاف پوشش و نه سوژه رو به رشدی که کسی برنداشته باشد.</p>`) +
    section(`تیم الان چه می‌نویسد${stalledCount ? ` <span class="badge late">${fa(stalledCount)} معطل</span>` : ""}`, "", taken.length && `<ul class="need">${taken.map((s) =>
      dashStory(s, `${takenBadge(s, now)}${newsOnOurSite(s) ? `<span class="badge ok">در سایت شما</span>`
        : stalled(s) ? `<span class="badge late" title="«من می‌نویسم» زده شده و هنوز روی هیچ‌کدام از سایت‌های تیم نیامده است">${duration(waited(s))}، هنوز منتشر نشده</span>` : ""}`)).join("")}</ul>`) +
    // a desk's row opens the stories it has not told yet (openDesks keeps it open across the redraws)
    section("پوشش به تفکیک میز", "topics", desks.length > 1 && `<div class="bars">${desks.map((d) => {
      const row = `<span class="bar-label">${esc(d.name)}</span><span class="bar"><i style="width:${Math.round((100 * d.ours) / d.all)}%"></i></span>
      <span class="bar-val">${fa(d.ours)} از ${fa(d.all)}</span>`;
      return d.missing.length ? `<details class="desk" data-desk="${esc(d.name)}"${openDesks.has(d.name) ? " open" : ""}>
      <summary class="bar-row" title="${fa(d.missing.length)} سوژه پوشش‌داده‌نشده">${row}</summary>
      <ul class="need">${d.missing.map((s) => dashStory(s, s.mark?.status === "taken" ? takenBadge(s, now) : "")).join("")}</ul></details>`
        : `<div class="bar-row">${row}</div>`;
    }).join("")}</div>`, !!mineS) +
    section(`مقایسه با رسانه‌های دیگر (${fa(prefs.hours)} ساعت)`, "topics", rankHtml) +
    section(`سوژه‌های داغ رسانه‌ها`, "topics", hot && bars(hot.slice(0, 5).map((s) => ({ label: s.title, href: s.items?.[0]?.url, value: s.sources,
      // beside the count, where the team stands on it: published, or a member writing it
      text: `${fa(s.sources)} منبع${s.ours ? ` <b class="has" title="در سایت شما">✓</b>` : s.mark?.status === "taken" ? ` <span title="می‌نویسد: ${esc(s.mark.by || "یکی از اعضا")}">✍</span>` : ""}` })))) +
    section(`شکاف پوشش ${gapS ? `<span class="muted" dir="ltr">${esc(gapS.domain)}</span>` : ""}`, "gap", gaps?.length && `<ul class="list">${gaps.slice(0, 3).map((s) =>
      `<li><a href="${safeUrl(s.items?.[0]?.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">رقبا: ${esc((s.competitors ?? []).join("، "))}</span></li>`).join("")}</ul>`) +
    section(`سرعت انتشار ما (۲۴ ساعت)`, "mine", speed) +
    section("سوژه‌های رسانه‌های خارجی", "global", global && bars(global.slice(0, 5).map((s) => ({ label: s.title, href: s.items?.[0]?.url, value: s.sources, text: `${fa(s.sources)} منبع` })))) +
    section("ترندهای گوگل", "trends", trends && bars(trends.slice(0, 6).map((t) => ({ label: t.title, href: newsUrl(t.title), value: trafficNumber(t.traffic), text: t.traffic ? esc(t.traffic) : "" })))) +
    section("ویکی‌پدیا: رو به رشد", "wiki", rising && bars(rising.slice(0, 5).map((x) => ({ label: x.article.replace(/_/g, " "), href: wikiLink(x.article), value: x.ratio, text: `${fa(Math.round(x.ratio))} برابر` })))) +
    section(`مناسبت‌های امروز${days?.solar ? ` (${esc(days.solar)})` : ""}`, "days", days && (round.length || days.occasions?.length) && `<ul class="list">${[
      ...(days.occasions ?? []).slice(0, 3).map((o) => `<li>${esc(o)}</li>`),
      ...round.slice(0, 4).map((e) => `<li>${esc(e.what)}: <span class="muted"><b>${fa(e.ago)}امین سالگرد</b></span></li>`)].join("")}</ul>`));
  };

  draw();
  await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    if (!path) return;
    const r = await newsApi(path);
    if (id !== loadId) return;
    d[name] = r.status === 200 ? r.data : null;
    if (d[name]) dashCache.set(path, d[name]);
    draw();
  }));
  // signed out while it loaded (newsApi drops the account on a 401)
  if (id === loadId && !(await newsAccount())) return signedOut();
}

// Draws html (a row of elements) into box and leaves alone the elements that are the same as last time: a card that did
// not change keeps its scroll, its hover and its open rows, and nothing flashes. Not keyed: an element is «the same»
// when its html is, so one that changed is put in anew and the old one goes.
function patch(box, html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const old = [...box.children];
  // what another tab drew (or loose text) goes first
  if (!old.some((el) => el.patched)) box.textContent = "";
  let at = 0;
  for (const el of [...template.content.children]) {
    const mark = el.outerHTML;
    const same = old.findIndex((o, n) => n >= at && o.patched === mark);
    if (same < 0) {
      el.patched = mark;
      if (old[at]?.isConnected) old[at].before(el); else box.append(el);
      continue;
    }
    for (; at < same; at++) old[at].remove();
    at++;
  }
  for (; at < old.length; at++) old[at].remove();
}

const tile = (go, value, label, tone = "") => `<button class="tile ${tone}" type="button" data-go="${go}"><b>${value}</b><span>${label}</span></button>`;
const dashSection = (title, go, body) => body ? `<section class="card"><h3 class="head"><span>${title}</span>${go ? `<a href="#" data-go="${go}">همه</a>` : ""}</h3>${body}</section>` : "";
// a member's «من می‌نویسم» that old with the story still on none of the team's sites is «معطل» on the dashboard
const STALLED_MINUTES = 45;
// A story on the dashboard, one row: the headline, why it is there, how many told it, and «من می‌نویسم» while it is free
// (the click marks it for the team and draws the dashboard again, where it moves to «تیم الان چه می‌نویسد»).
const dashStory = (s, badges) => `<li><a dir="auto" title="${esc(s.title)}" href="${safeUrl(s.items?.[0]?.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${badges}
  <span class="muted">${s.sources ? `${fa(s.sources)} منبع` : s.channels ? `${fa(s.channels)} کانال` : ""}</span>${s.mark?.status === "taken" ? "" : takeButton(s)}</li>`;

// Horizontal bars, longest = the largest value. rows: { label, href, value, text }; text is already escaped.
function bars(rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.value || 0), 1);
  return `<div class="bars">${rows.map((r) => `<div class="bar-row">
      <a class="bar-label" dir="auto" href="${safeUrl(r.href)}" target="_blank" rel="noopener" title="${esc(r.label)}">${esc(r.label)}</a>
      <span class="bar"><i style="width:${Math.max(4, Math.round((100 * (r.value || 0)) / max))}%"></i></span>
      <span class="bar-val">${r.text}</span></div>`).join("")}</div>`;
}

// the desks opened on «پوشش به تفکیک میز»; toggle does not bubble, hence the capture
const openDesks = new Set();
main.addEventListener("toggle", (e) => {
  const name = e.target.dataset?.desk;
  if (name) openDesks[e.target.open ? "add" : "delete"](name);
}, true);

main.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (!g) return;
  e.preventDefault();
  show(g.dataset.go);
});

// the search box's text, kept across the refreshes
let topicQuery = "";
// «بیشترین منبع» is the server's order; «رو به رشد»: the stories most sites picked up in the last risingMinutes
const TOPIC_SORTS = {
  top: { name: "بیشترین منبع", by: () => 0 },
  rising: { name: "رو به رشد", by: (a, b) => (b.recent ?? 0) - (a.recent ?? 0) },
  newest: { name: "تازه‌ترین", by: (a, b) => Date.parse(b.firstAt) - Date.parse(a.firstAt) },
};

async function showTopics(id) {
  const prefs = await newsPrefs();
  // in sight: the period, the order and the search; behind «فیلتر»: the least sources, «بدون آنچه زده‌ایم» and own topics
  main.innerHTML = controlsHtml(
    `${hoursHtml(prefs)}
     <label>ترتیب <select id="tsort">${Object.entries(TOPIC_SORTS).map(([key, sort]) => `<option value="${key}" ${key === prefs.topicSort ? "selected" : ""}>${sort.name}</option>`).join("")}</select></label>
     <input id="q" type="search" placeholder="جستجو در تیترها" aria-label="جستجو در تیترها" value="${esc(topicQuery)}" style="flex:1;min-width:100px" />`,
    `<label>حداقل منبع <select id="min"${newsFocused(prefs) ? ` disabled title="با «فقط کلیدواژه‌های من»، سوژه‌های تک‌منبعی هم می‌آیند"` : ""}>${[2, 3, 5, 8].map((m) => `<option value="${m}" ${m === prefs.minSources ? "selected" : ""}>${fa(m)}</option>`).join("")}</select></label>
     <label><input id="tours" type="checkbox" ${prefs.topicHideOurs ? "checked" : ""} /> بدون آنچه زده‌ایم</label>`,
    (prefs.minSources !== 2 && !newsFocused(prefs) ? 1 : 0) + (prefs.topicHideOurs ? 1 : 0) + (prefs.topics.length ? 1 : 0))
    + `<div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  wireControls();
  const bar = topicBar(prefs, () => show("topics"));
  if (bar) document.getElementById("fpanel").append(bar);
  wireHours("topics");
  document.getElementById("min").onchange = async (e) => { await saveNewsPrefs({ minSources: +e.target.value }); show("topics"); };
  document.getElementById("tsort").onchange = async (e) => { await saveNewsPrefs({ topicSort: e.target.value }); show("topics"); };
  document.getElementById("tours").onchange = async (e) => { await saveNewsPrefs({ topicHideOurs: e.target.checked }); show("topics"); };
  let stories = null, now = null, note = "", hidden = "";
  const list = document.getElementById("list");
  // any part of any headline, folded as the filters (ی/ي, digits, half-spaces)
  const render = () => {
    const q = newsFold(topicQuery);
    const shown = (q ? stories.filter((s) => [s.title, ...s.items.map((i) => i.title)].some((t) => newsFold(t).includes(q))) : [...stories])
      .filter((s) => !prefs.topicHideOurs || !s.ours)
      .sort((TOPIC_SORTS[prefs.topicSort] ?? TOPIC_SORTS.top).by);
    setExport("سوژه‌های داغ", STORY_HEADER, shown.map((s) => storyRow(s)));
    list.innerHTML = note + (shown.length ? shown.map((s) => storyCard(s, now)).join("")
      : `<div class="empty">${q ? `سوژه‌ای با «${esc(topicQuery)}» نیست.` : newsFocused(prefs) ? "در این بازه سوژه‌ای با کلیدواژه‌های شما نیست؛ بازه را بلندتر کنید." : `در این بازه سوژه‌ای با این تعداد منبع${prefs.topics.length ? " در موضوع‌های انتخاب‌شده" : ""} نیست.`}</div>`) + hidden;
  };
  document.getElementById("q").oninput = (e) => { topicQuery = e.target.value; if (stories) render(); };
  // ponytail: under «فقط کلیدواژه‌های من» (topicMinSources) the server still sends only the 60 stories with the most
  // sites, so a one-site story of a busy period can be left out; an api/News endpoint that searches the headlines for
  // the words would find them all.
  const res = await newsApi(`topics?hours=${prefs.hours}&minSources=${topicMinSources(prefs)}`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  const personal = newsPersonal(res.data.stories, prefs);
  stories = await markFresh(personal);
  hidden = hiddenNote(res.data.teamHidden ?? 0, (res.data.stories ?? []).length - personal.length);
  risingMinutes = res.data.risingMinutes ?? risingMinutes;
  now = res.data.now;
  note = staleNote(res.data);
  if (id === loadId) render();
}

// Why a story the user expects is not on the list: how many the team's filters (the server's count) and the user's own
// (counted here) left out. Empty when neither hides anything.
function hiddenNote(team, personal) {
  const parts = [team > 0 ? `${fa(team)} سوژه با فیلتر تیم` : "", personal > 0 ? `${fa(personal)} سوژه با فیلتر شما` : ""].filter(Boolean);
  return parts.length ? `<p class="muted hidden-note">${parts.join(" و ")} پنهان است. فیلترهای شما در ⚙ تنظیمات است${state?.access?.role === "owner"
    ? `؛ <a href="${safeUrl((state?.panelUrl ?? "") + "?tab=filters")}" target="_blank" rel="noopener">فیلترهای تیم در پنل</a>` : " و فیلترهای تیم را صاحب اشتراک در پنل تعیین می‌کند"}.</p>` : "";
}

// What a coverage gap needs, as three steps with what is done ticked: a site of the team, that site's feed, and its
// competitors. All three are set in the panel by the subscription owner.
// forMine: «مطالب ما» needs the first two only.
function gapGuide(site, forMine = false) {
  const owner = state?.access?.role === "owner";
  const link = `<a class="btn" href="${safeUrl((state?.panelUrl ?? "") + "?tab=sites")}" target="_blank" rel="noopener">سایت و رقبا در پنل</a>`;
  const step = (done, title, text) => `<li class="${done ? "done" : ""}"><b>${done ? "✓ " : ""}${title}</b><span class="muted">${text}</span></li>`;
  return `<section class="card guide">
    <h3>${forMine ? "«مطالب ما» با دو قدم راه می‌افتد" : "شکاف پوشش با سه قدم راه می‌افتد"}</h3>
    <ol>
      ${step(!!site, "سایت خود را انتخاب کنید", "از سایت‌هایی که در پنل جت‌سئو دارید.")}
      ${step(!!site?.hasFeed, "فید سایت ثبت شود", "فید (RSS) نشانی‌ای روی سایت شماست که تازه‌ترین خبرها را فهرست می‌کند؛ بدون آن معلوم نیست چه چیزی را منتشر کرده‌اید.")}
      ${forMine ? "" : step(!!site?.competitors, "۵ تا ۱۰ رقیب هم‌حوزه انتخاب کنید", "سوژه‌ای که دست‌کم دو رقیب زده‌اند و شما نه، این‌جا می‌آید و هشدار می‌دهد.")}
    </ol>
    ${owner ? link : `<p class="muted">این موارد را صاحب اشتراک${state?.access?.ownerName ? ` (${esc(state.access.ownerName)})` : ""} در پنل جت‌سئو تنظیم می‌کند.</p>`}
  </section>`;
}

async function showGap(id) {
  const sites = state?.sites ?? [];
  if (!sites.length) {
    main.innerHTML = gapGuide(null);
    return;
  }
  const prefs = await newsPrefs();
  main.innerHTML = controlsHtml(
    `${sites.length > 1 ? `<select id="site" aria-label="سایت">${sites.map((s) => `<option value="${s.id}" ${s.id === gapSite ? "selected" : ""}>${esc(s.domain)}</option>`).join("")}</select>` : `<strong dir="ltr">${esc(sites[0].domain)}</strong>`}
     ${hoursHtml(prefs)}`)
    + `<div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  const siteSelect = document.getElementById("site");
  if (siteSelect) siteSelect.onchange = (e) => { gapSite = +e.target.value; show("gap"); };
  wireHours("gap");
  const site = sites.find((s) => s.id === gapSite) ?? sites[0];
  const list = document.getElementById("list");
  if (!site.hasFeed || !site.competitors) { list.innerHTML = gapGuide(site); return; }
  const res = await newsApi(`gap?siteId=${site.id}&hours=${prefs.hours}`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  const skipped = await newsSkipped();
  if (id !== loadId) return;
  const key = (s) => `${site.id}:${s.id}`;
  risingMinutes = res.data.risingMinutes ?? risingMinutes;
  const stories = newsPersonal(res.data.stories, prefs).filter((s) => !skipped.has(key(s)));
  setExport(`شکاف پوشش ${site.domain}`, [...STORY_HEADER, "رقبایی که زده‌اند"], stories.map((s) => storyRow(s, [(s.competitors ?? []).join("، ")])));
  list.innerHTML = staleNote(res.data) + `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minCompetitors)} رقیب از ${fa(res.data.competitors)} رقیب شما کار کرده‌اند و ${esc(res.data.site)} نه.</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now, {
      meta: `<span>رقبا: ${esc((s.competitors ?? []).join("، "))}</span>`,
      menu: `<button class="btn ghost small" type="button" data-skip="${esc(key(s))}" title="کار نمی‌کنیم؛ برای همه تیم پنهان می‌شود و هشدار نمی‌دهد">رد شد</button>`,
    })).join("") : `<div class="empty">${emptyText(prefs, "شکافی نیست؛ هرچه رقبا زده‌اند، شما هم زده‌اید.")}</div>`);
  chrome.runtime.sendMessage({ type: "news-gap-seen", ids: stories.map((s) => `${site.id}:${s.id}`) }).catch(() => {});
}

// «رسانه‌های خارجی»: stories several foreign (English) sources told, with the Persian headlines the server found for them,
// if any (api/News/foreign). The headlines are English and left to right; everything around them is Persian, like the
// rest of the app. JetSEO translates nothing: each headline links to its article and to Google Translate's page of it.
const translateUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? `https://translate.google.com/translate?sl=auto&tl=fa&u=${encodeURIComponent(u)}` : "#");
const CATEGORY_FA = { general: "خبر عمومی و جهان", agency: "خبرگزاری‌ها", economy: "اقتصاد و کریپتو", tech: "فناوری", science: "علم", health: "سلامت", auto: "خودرو", sport: "ورزش", culture: "فرهنگ و بازی" };

// s.covers: Persian headlines that hold the story's Latin names («GPT», «OpenAI»); s.ours: the same on the team's own
// sites. The server finds only those: a story without one may still be told in Persian with every name in Persian
// letters, so no card says «پوشش داده نشده». s.recent: sources that joined in the last risingHours; s.watch: a watched
// word (the team's, or the user's own: newsGlobal); s.key: its names, for «مردم چه می‌پرسند؟»; s.mark: the team's mark.
function globalCard(s, now, risingHours) {
  const items = s.items ?? [];
  const covers = s.covers ?? [];
  const ours = s.ours ?? [];
  const first = items[0];
  const dismissed = s.mark?.status === "dismissed";
  const translate = (url) => `<a href="${esc(translateUrl(url))}" target="_blank" rel="noopener" title="صفحه ترجمه فارسی این خبر در گوگل ترنسلیت">ترجمه</a>`;
  const headlines = items.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
      <span class="muted" dir="rtl"><bdi>${esc(i.source)}</bdi> · ${ago(i.at, now)} · ${translate(i.url)}</span></li>`).join("");
  const persian = (list) => list.map((c) => `<li><a href="${safeUrl(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a> <span class="muted">${esc(c.source)}</span></li>`).join("");
  return cardShell({
    title: s.title, url: first?.url, ltr: true, className: dismissed ? "dismissed" : "",
    count: `<span class="badge"${s.core ? ` title="${fa(s.core)} تا از این منابع، رسانه‌های اصلی‌اند"` : ""}>${fa(s.sources)} منبع${s.core ? ` · ${fa(s.core)} اصلی` : ""}</span>`,
    badges: [
      takenBadge(s, now),
      dismissed ? `<span class="badge">رد شده: ${esc(s.mark.by || "یکی از اعضا")} · ${ago(s.mark.at, now)}</span>` : "",
      s.watch ? watchBadge(s) : "",
      ours.length ? `<span class="badge ok" title="نام‌های لاتین این سوژه در تیتر یکی از سایت‌های تیم هست">در سایت شما</span>`
        : covers.length ? `<span class="badge ok" title="نام‌های لاتین این سوژه در تیتر یک رسانه فارسی هست">در رسانه فارسی دیده شد</span>` : "",
      s.recent >= 2 ? `<span class="badge new" title="منابعی که در ${fa(risingHours)} ساعت اخیر این سوژه را زده‌اند">${fa(s.recent)} منبع تازه</span>` : "",
    ],
    meta: first ? `<span>اولین: <bdi>${esc(first.source)}</bdi> · ${ago(s.firstAt, now)}</span> ${translate(first.url)}` : "",
    main: takeButton(s),
    menu: [
      s.key ? `<button class="btn ghost small" type="button" data-gangles="${esc(s.key)}" title="آنچه مخاطب ایرانی همراه نام‌های این سوژه جستجو می‌کند">مردم چه می‌پرسند؟</button>` : "",
      promptButton(s, "foreign"),
      `<button class="btn ghost small" type="button" data-mark="${dismissed ? "none" : "dismissed"}" data-story="${esc(s.id)}" title="${dismissed ? "سوژه دوباره برای همه تیم نمایش داده می‌شود" : "سوژه برای همه اعضای تیم پنهان می‌شود"}">${dismissed ? "برگرداندن برای تیم" : "رد برای تیم"}</button>`,
    ],
    details: `<div class="sub">تیترها (${fa(items.length)})</div><ul dir="ltr" lang="en">${headlines}</ul>
      ${ours.length ? `<div class="sub">در سایت شما (${fa(ours.length)})</div><ul lang="fa">${persian(ours)}</ul>` : ""}
      ${covers.length ? `<div class="sub">تیترهای فارسی پیداشده (${fa(covers.length)})</div><ul lang="fa">${persian(covers)}</ul>` : ""}`,
  });
}

// «مردم چه می‌پرسند؟» of a foreign story: Google's suggestions in Iran for its names (s.key, «nvidia jensen huang»), then for
// fewer of them until Google knows the phrase. On the click only, like the Persian stories' «مردم چه می‌پرسند؟».
main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-gangles]");
  if (!b) return;
  // in the click's user gesture, before anything is awaited; true at once when already granted
  const allowed = chrome.permissions.request({ origins: [SUGGEST_ORIGIN] }).catch(() => false);
  const out = b.closest(".card").querySelector(".angles");
  b.disabled = true;
  if (!(await allowed)) {
    b.disabled = false;
    out.innerHTML = `<div class="muted">این پیشنهادها از جستجوی گوگل خوانده می‌شوند؛ بدون اجازه دسترسی به آن نشان داده نمی‌شوند.</div>`;
    return;
  }
  const words = b.dataset.gangles.split(/\s+/).filter(Boolean);
  let q = "", angles = [];
  for (q of new Set([words.length, 2, 1].map((n) => words.slice(0, n).join(" ")))) {
    angles = await suggestions(q);
    if (angles.length) break;
  }
  newsUsed("angles", globalCategory);
  out.innerHTML = angles.length ? angleChips(angles, q) : `<div class="muted">گوگل برای نام‌های این سوژه جستجوی مرتبطی پیشنهاد نمی‌دهد.</div>`;
  b.hidden = true;
  addAngles(b.closest(".card"), angles);
});

// «بیشترین منبع» is the server's order (a core outlet weighs double). «رو به رشد»: the stories most sources picked up
// in the last hours. «همه»: also the stories one source alone told (min 1), for the fields whose sites seldom tell the
// same story (science, health).
const GLOBAL_SORTS = {
  top: { name: "بیشترین منبع", by: () => 0 },
  rising: { name: "رو به رشد", by: (a, b) => b.recent - a.recent },
  newest: { name: "تازه‌ترین", by: (a, b) => Date.parse(b.firstAt) - Date.parse(a.firstAt) },
  all: { name: "همه، حتی تک‌منبعی", by: () => 0, min: 1 },
};
// until the panel closes: a look at what the team set aside, not a setting
let globalShowDismissed = false;

async function showGlobal(id) {
  if (!state?.foreignNews) {
    main.innerHTML = `<div class="center">
      <p><strong>رسانه‌های خارجی</strong></p>
      <p>سوژه‌هایی که رسانه‌های خارجی همین حالا کار می‌کنند، پیش از آن‌که به رسانه‌های فارسی برسند؛ هرکدام با لینک خبر و ترجمه فارسی آن.</p>
      <p class="muted">این بخش در اشتراک فعلی جت‌سئو نیوز شما نیست. ${state?.access?.role === "owner" ? `<a href="${safeUrl(state?.panelUrl)}" target="_blank" rel="noopener">دیدن پله‌های اشتراک</a>` : "از صاحب اشتراک بخواهید آن را ارتقا دهد."}</p>
    </div>`;
    return;
  }
  const prefs = await newsPrefs();
  const categories = state.foreignCategories ?? [];
  const category = categories.includes(prefs.globalCategory) ? prefs.globalCategory : "";
  const sort = GLOBAL_SORTS[prefs.globalSort] ?? GLOBAL_SORTS.top;
  const select = (idName, options, current) => `<select id="${idName}">${options.map(([value, name]) => `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>`;
  main.innerHTML = `<div class="global">` + controlsHtml(
    `<label>بازه ${select("glhours", [6, 24, 72].map((h) => [h, `${fa(h)} ساعت`]), prefs.globalHours)}</label>
     <label>ترتیب ${select("glsort", Object.entries(GLOBAL_SORTS).map(([key, x]) => [key, x.name]), prefs.globalSort)}</label>`,
    `${categories.length > 1 ? `<label>حوزه ${select("glcat", [["", "همه"], ...categories.map((c) => [c, CATEGORY_FA[c] ?? c])], category)}</label>` : ""}
     <label><input id="glseen" type="checkbox" ${prefs.globalHideSeen ? "checked" : ""} /> بدون آنچه در رسانه فارسی دیده شده</label>
     <label><input id="gldismissed" type="checkbox" ${globalShowDismissed ? "checked" : ""} /> نمایش ردشده‌های تیم</label>`,
    (category ? 1 : 0) + (prefs.globalHideSeen ? 1 : 0) + (globalShowDismissed ? 1 : 0)) +
    `<div id="list"><div class="empty">در حال بارگذاری…</div></div></div>`;
  wireControls();
  document.getElementById("glhours").onchange = async (e) => { await saveNewsPrefs({ globalHours: +e.target.value }); show("global"); };
  document.getElementById("glsort").onchange = async (e) => { await saveNewsPrefs({ globalSort: e.target.value }); show("global"); };
  document.getElementById("gldismissed").onchange = (e) => { globalShowDismissed = e.target.checked; show("global"); };
  document.getElementById("glseen").onchange = async (e) => { await saveNewsPrefs({ globalHideSeen: e.target.checked }); show("global"); };
  const cat = document.getElementById("glcat");
  if (cat) cat.onchange = async (e) => { await saveNewsPrefs({ globalCategory: e.target.value }); show("global"); };
  const list = document.getElementById("list");
  const res = await newsApi(`foreign?hours=${prefs.globalHours}${category ? `&category=${encodeURIComponent(category)}` : ""}${sort.min ? `&minSources=${sort.min}` : ""}`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  globalCategory = category;
  countOnce("global-open", category);
  const all = newsGlobal(res.data.stories, prefs, globalShowDismissed);
  // the server's order is «بیشترین منبع»; a sort that leaves two stories equal keeps it between them
  const stories = (prefs.globalHideSeen ? all.filter((s) => !s.covers?.length && !s.ours?.length) : all).sort(sort.by);
  setExport("رسانه‌های خارجی", ["تیتر", "تعداد منبع", "اولین منبع", "اولین انتشار", "در رسانه فارسی", "وضعیت تیم", "لینک", "ترجمه", "منابع"], stories.map((s) => [
    s.title, s.sources ?? 0, s.items?.[0]?.source ?? "", csvTime(s.firstAt), s.ours?.length ? "در سایت شما" : s.covers?.length ? "دیده شد" : "",
    s.mark?.status === "taken" ? `می‌نویسد: ${s.mark.by || "یکی از اعضا"}` : s.mark?.status === "dismissed" ? "رد شده" : "",
    s.items?.[0]?.url ?? "", s.items?.[0] ? translateUrl(s.items[0].url) : "", (s.items ?? []).map((i) => i.source).join(", ")]));
  list.innerHTML = staleNote(res.data) +
    `<details class="about muted"><summary>سوژه‌هایی که دست‌کم ${fa(res.data.minSources)} رسانه خارجی گفته‌اند. <u>بیشتر</u></summary>«در رسانه فارسی دیده شد» یعنی نام‌های لاتین سوژه (شرکت، محصول) در تیتر یک رسانه فارسی هست؛ سوژه بدون این برچسب هم ممکن است به فارسی کار شده باشد، پس پیش از نوشتن بررسی کنید.</details>` +
    (stories.length ? stories.map((s) => globalCard(s, res.data.now, res.data.risingHours)).join("")
      : `<div class="empty">${all.length ? "همه سوژه‌های این بازه در رسانه‌های فارسی دیده شده‌اند." : emptyText(prefs, "در این بازه سوژه‌ای با این تعداد منبع نیست.")}</div>`);
}

// «۲ ساعت و ۵ دقیقه»
function duration(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${fa(h)} ساعت${m ? ` و ${fa(m)} دقیقه` : ""}` : `${fa(m)} دقیقه`;
}

function lagBadge(item) {
  if (item.lagMinutes == null) return `<span class="badge">رقیبی کار نکرده</span>`;
  if (item.lagMinutes <= 0) return `<span class="badge ok">اول شما منتشر کردید</span>`;
  return `<span class="badge ${item.lagMinutes >= 60 ? "late" : "watch"}">${duration(item.lagMinutes)} بعد از ${esc(item.firstCompetitor)}</span>`;
}

// «مطالب ما»: the site's own articles of the window, how far behind its competitors each was, and the news SEO check
// (CoreApi api/News/check: only URLs on the team's own sites).
async function showMine(id) {
  const check = pendingCheck;
  pendingCheck = null;
  const sites = state?.sites ?? [];
  if (!sites.length) {
    main.innerHTML = gapGuide(null, true);
    return;
  }
  const site = sites.find((s) => s.id === gapSite) ?? sites[0];
  main.innerHTML = `<div class="controls">
      ${sites.length > 1 ? `<select id="msite" aria-label="سایت">${sites.map((s) => `<option value="${s.id}" ${s.id === site.id ? "selected" : ""}>${esc(s.domain)}</option>`).join("")}</select>` : `<strong dir="ltr">${esc(site.domain)}</strong>`}
    </div>
    <form id="checkform" class="controls">
      <input id="checkurl" type="url" dir="ltr" placeholder="آدرس یک خبر سایت شما" style="flex:1;min-width:0" aria-label="آدرس خبر" required />
      <button class="btn ghost" type="submit">بررسی سئو</button>
    </form>
    <div id="checkout"></div>
    <div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  const msite = document.getElementById("msite");
  if (msite) msite.onchange = (e) => { gapSite = +e.target.value; show("mine"); };
  document.getElementById("checkform").onsubmit = (e) => {
    e.preventDefault();
    runCheck(document.getElementById("checkurl").value.trim(), document.getElementById("checkout"));
  };
  if (check) {
    document.getElementById("checkurl").value = check;
    runCheck(check, document.getElementById("checkout"));
  }
  const list = document.getElementById("list");
  if (!site.hasFeed) { list.innerHTML = gapGuide(site, true); return; }
  const res = await newsApi(`mine?siteId=${site.id}&hours=24`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  const items = res.data.items ?? [];
  const covered = items.filter((i) => i.lagMinutes != null);
  const late = covered.filter((i) => i.lagMinutes > 0);
  const summary = covered.length
    ? `در ${fa(covered.length)} خبر که رقبا هم کار کردند، ${fa(covered.length - late.length)} بار اول شما بودید` +
      (late.length ? `؛ بقیه به‌طور میانه ${duration(late.map((i) => i.lagMinutes).sort((a, b) => a - b)[Math.floor(late.length / 2)])} دیرتر.` : ".")
    : "";
  setExport(`مطالب ما ${site.domain}`, ["تیتر", "زمان انتشار", "دقیقه بعد از اولین رقیب", "اولین رقیب", "تعداد رقبایی که زده‌اند", "لینک"],
    items.map((i) => [i.title, csvTime(i.at), i.lagMinutes ?? "", i.firstCompetitor ?? "", i.competitors ?? 0, i.url]));
  list.innerHTML = staleNote(res.data) + `<p class="muted">خبرهای ۲۴ ساعت اخیر ${esc(res.data.site)}. ${summary}</p>` + (items.length ? items.map((i, n) => `<article class="card">
      <h3><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <div class="meta">${lagBadge(i)} <span>${ago(i.at, res.data.now)}</span>
        ${i.lagMinutes != null ? `<button class="btn ghost small" type="button" data-compare="${n}">مقایسه تیتر</button>` : ""}
        <button class="btn ghost small" type="button" data-check="${n}">بررسی سئو</button></div>
      <div data-cmp="${n}"></div>
      <div data-out="${n}"></div>
    </article>`).join("") : `<div class="empty">در ۲۴ ساعت اخیر خبری از این سایت خوانده نشده است.</div>`);
  list.onclick = (e) => {
    const b = e.target.closest("button[data-check]");
    if (b) runCheck(items[+b.dataset.check].url, list.querySelector(`[data-out="${b.dataset.check}"]`));
    const c = e.target.closest("button[data-compare]");
    if (c) compareTitles(items[+c.dataset.compare], site.domain, res.data.now, list.querySelector(`[data-cmp="${c.dataset.compare}"]`));
  };
}

// «مقایسه تیتر»: the headlines other sites gave the same story, from «سوژه‌های داغ» (api/News/topics with minSources=1)
// over the smallest window back to the story's first headline. ponytail: topics returns the 60 stories with the most
// sites, 12 headlines each; a story outside them is not found (an api/News endpoint by URL would find any).
async function compareTitles(item, domain, now, out) {
  out.innerHTML = `<div class="muted">در حال یافتن تیترهای دیگر…</div>`;
  const from = Math.min(Date.parse(item.at), Date.parse(item.at) - item.lagMinutes * 60000);
  const hours = Math.min(24, Math.max(1, Math.ceil((Date.parse(now) - from) / 3600000 + 0.05)));
  const res = await newsApi(`topics?hours=${hours}&minSources=1`);
  if (res.status !== 200) { out.innerHTML = `<div class="muted">تیترها بارگذاری نشد.</div>`; return; }
  const ours = (i) => i.url === item.url || newsHost(i.domain) === newsHost(domain);
  const story = (res.data.stories ?? []).find((s) => s.items?.some((i) => i.url === item.url || (ours(i) && newsFold(i.title) === newsFold(item.title))));
  const others = (story?.items ?? []).filter((i) => !i.telegram && !ours(i));
  if (!others.length) { out.innerHTML = `<div class="muted">تیتر سایت‌های دیگر برای این خبر پیدا نشد؛ شاید جزو ۶۰ سوژه پرمنبع این بازه نیست.</div>`; return; }
  const len = (t) => `${fa([...String(t)].length)} حرف`;
  const when = (at) => {
    const m = Math.round((Date.parse(at) - Date.parse(item.at)) / 60000);
    return m === 0 ? "هم‌زمان با ما" : `${duration(Math.abs(m))} ${m < 0 ? "قبل" : "بعد"} از ما`;
  };
  const missing = headlineGap(item.title, others.map((i) => i.title));
  out.innerHTML = `<div class="checks"><div class="muted">تیتر همین خبر در ${fa(others.length)} سایت دیگر:</div>
    <ul class="list"><li class="ours"><b>${esc(item.title)}</b> <span class="muted">ما · ${len(item.title)}</span></li>${others.map((i) =>
      `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${esc(i.source)} · ${len(i.title)} · ${when(i.at)}</span></li>`).join("")}</ul>
    ${missing.length ? `<div class="sub">در تیتر بیشتر سایت‌ها هست و در تیتر ما نه</div><div class="chips">${missing.map(([w, c]) =>
      `<span class="chip">${esc(w)} <span class="muted">${fa(c)}</span></span>`).join("")}</div>` : ""}</div>`;
}

async function runCheck(url, out) {
  out.innerHTML = `<div class="muted">در حال بررسی…</div>`;
  const res = await newsApi(`check?url=${encodeURIComponent(url)}`);
  const reasons = { "not-your-site": "فقط خبرهای سایت‌های تیم شما بررسی می‌شوند.", "bad-url": "آدرس معتبر نیست.", "too-many": "در این ساعت بیش از حد بررسی شده است؛ کمی بعد." };
  if (res.status !== 200) { out.innerHTML = `<div class="muted">${esc(reasons[res.data?.reason] ?? "بررسی انجام نشد.")}</div>`; return; }
  const r = res.data;
  if (r.error) { out.innerHTML = `<div class="muted">${esc(r.error)}</div>`; return; }
  const icon = { ok: "✓", warn: "!", bad: "✕" };
  out.innerHTML = `<div class="checks"><div class="muted">${fa(r.ok)} از ${fa(r.total)} مورد درست است.</div>` +
    r.checks.map((c) => `<div class="check ${esc(c.level)}"><b>${icon[c.level] ?? ""} ${esc(c.title)}</b> <span>${esc(c.message)}</span></div>`).join("") + `</div>`;
}

// The free tabs: Google Trends, Persian Wikipedia and the occasions, from CoreApi (api/News/google, wiki, days), which
// reads them through ai.jetseo.ir: Google Trends, Wikipedia and Wikimedia are filtered in Iran. 502 = not readable now.
// out: where the loading and error text go, so the mode buttons above it stay usable when a list fails
async function freeApi(id, path, what, out = main) {
  out.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  const res = await newsApi(path);
  if (id !== loadId) return null;
  if (res.status === 401) { signedOut(); return null; }
  if (res.status !== 200) { out.innerHTML = loadFailed(res, what); return null; }
  return res.data;
}

// The modes of a tab as always-visible buttons above #list; extra: more controls beside them.
function modeBar(modes, current, pick, extra = "") {
  main.innerHTML = `<div class="controls"><div class="seg" role="group" aria-label="نوع فهرست">${Object.entries(modes).map(([v, t]) =>
    `<button type="button" data-mode="${v}" class="${v === current ? "on" : ""}" aria-pressed="${v === current}">${t}</button>`).join("")}</div>${extra}</div>
    <div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  main.querySelector(".seg").onclick = (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b && b.dataset.mode !== current) pick(b.dataset.mode);
  };
}

// The suggestions as links, each without base, the phrase they were asked for: «گنو پتریاشویلی خداحافظی» → «خداحافظی»
function angleChips(angles, base, heading = "مردم این‌ها را هم جستجو می‌کنند") {
  const short = (s) => s.replace(base, "").trim() || s;
  return `<div class="sub">${heading}</div><div class="chips">${angles.map((s) =>
    `<a class="chip" href="https://www.google.com/search?q=${encodeURIComponent(s)}&hl=fa" target="_blank" rel="noopener" title="${esc(s)}">${esc(short(s))}</a>`).join("")}</div>`;
}

// Google's autocomplete for a phrase: what readers search along with it, i.e. the angles worth writing.
// Google Search is not filtered in Iran, so it is read directly. The host permission is optional (a new required one
// would disable the extension on update until the user approves it): asked on the first «مردم چه می‌پرسند؟» click.
const SUGGEST_ORIGIN = "https://suggestqueries.google.com/*";
async function suggestions(q) {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&hl=fa&gl=ir&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(q)}`, { credentials: "omit" });
    const [, list] = await r.json();
    return (list ?? []).filter((s) => s !== q).slice(0, 8);
  } catch (error) {
    return [];
  }
}

async function showTrends(id) {
  const data = await freeApi(id, "google", "ترندهای گوگل");
  if (!data) return;
  const items = data.trends ?? [];
  // the brief for the team; «مردم چه می‌پرسند؟» adds the angles to it
  const brief = (t) => [`ترند گوگل: ${t.title}${t.traffic ? ` (${t.traffic} جستجو)` : ""}`,
    ...(t.news ?? []).slice(0, 3).map((x) => `خبر: ${x.title} ${x.url}`)].join("\n");
  setExport("ترند گوگل", ["ترند", "جستجو", "جستجو در گوگل", "خبرهای مرتبط"], items.map((t) =>
    [t.title, t.traffic ?? "", `https://www.google.com/search?q=${encodeURIComponent(t.title)}&hl=fa`, (t.news ?? []).map((x) => `${x.title} ${x.url}`).join(" | ")]));
  main.innerHTML = `<p class="muted">جستجوهای داغ امروز گوگل در ایران، با خبرهایی که گوگل به هرکدام وصل کرده. «مردم چه می‌پرسند؟» چیزهایی را می‌آورد که مخاطب همراه آن جستجو می‌کند؛ هرکدام می‌تواند تیتر یا میان‌تیتر یک مطلب باشد.</p>` +
    (items.length ? items.map((t) => `<article class="card">
      <h3><a href="https://www.google.com/search?q=${encodeURIComponent(t.title)}&hl=fa" target="_blank" rel="noopener">${esc(t.title)}</a></h3>
      <div class="meta">${t.traffic ? `<span class="badge">${esc(t.traffic)} جستجو</span>` : ""}
        <a href="${newsUrl(t.title)}" target="_blank" rel="noopener">خبرهای فارسی</a>
        <button class="btn ghost small" type="button" data-angles="${esc(t.title)}" title="آنچه مخاطب همراه این ترند جستجو می‌کند">مردم چه می‌پرسند؟</button>
        <button class="btn ghost small" type="button" data-copy="${esc(brief(t))}" title="کپی بریف برای تحریریه">کپی بریف</button></div>
      ${t.news?.length ? `<div class="sub">خبرهای مرتبط</div><ul class="muted" style="margin:0;padding-inline-start:16px">${t.news.map((x) => `<li><a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("")}</ul>` : ""}
      <div class="angles"></div>
    </article>`).join("") : `<div class="empty">ترندی نیست.</div>`);
}

// «کلمات پرجستجو» (with the module): what readers search about a subject, like the panel's «کلمات کلیدی پرجستجو» but
// for a newsroom: the questions and the informational searches first. The phrases are Google's autocomplete for the
// subject alone and with each question or informational word before or after it, read in this browser (as the panel's
// tool does: Google blocks a server that asks this often); their monthly searches are JetSEO's (api/News/keywords).
// the last search, kept while the app is open: coming back to the list does not ask Google again
let kwSeed = "", kwRows = null, kwMode = "focus", kwNote = "";

// Google's suggestions for the subject and its question and informational forms, four requests at a time (a burst of
// thirty earns Google's «unusual traffic» page). Only phrases that hold every word of the subject, at most 300.
// Google answers some subjects only when written as one word («زنبورعسل», nothing for «زنبور عسل»): a subject of
// several words that finds fewer than KW_FEW phrases is asked again joined, and both answers are shown.
const KW_FEW = 10;
async function keywordIdeas(seed, progress) {
  const ideas = await keywordIdeasOf(seed, progress);
  const joined = seed.replace(/ /g, "");
  if (ideas.length >= KW_FEW || joined === seed) return ideas;
  // without the joined subject itself: the caller reads «more than the seed» as «Google answered»
  return [...new Set([...ideas, ...(await keywordIdeasOf(joined, progress)).filter((s) => s !== joined)])].slice(0, 300);
}

async function keywordIdeasOf(seed, progress) {
  const queries = [seed, ...KW_ASK.flatMap((w) => [`${w} ${seed}`, `${seed} ${w}`]), ...KW_INFO_ASK.map((w) => `${w} ${seed}`)];
  const found = new Set([seed]);
  for (let i = 0; i < queries.length; i += 4) {
    for (const s of (await Promise.all(queries.slice(i, i + 4).map(suggestions))).flat()) found.add(s.trim());
    progress(Math.min(i + 4, queries.length), queries.length);
  }
  const words = newsFold(seed).split(" ");
  return [...found].filter((s) => { const folded = ` ${newsFold(s)} `; return words.every((w) => folded.includes(` ${w} `)); }).slice(0, 300);
}

async function showKeywords(id) {
  main.innerHTML = `<p class="muted">موضوع، نام یا رویدادی را بنویسید (مثل «یارانه» یا «لیگ برتر») تا ببینید مخاطب درباره آن چه می‌پرسد و هر عبارت در ماه چند بار در گوگل جستجو می‌شود. عبارت‌های پرسشی و اطلاعاتی همان‌هایی‌اند که یک خبر، گزارش یا «هرآنچه باید بدانید» جوابشان را می‌دهد.</p>
    <p class="muted" id="kwperm" hidden>بار اول، کروم یک پنجره اجازه نشان می‌دهد (<span dir="ltr">suggestqueries.google.com</span>): فقط برای خواندن پیشنهادهای جستجوی گوگل است. «Allow» را بزنید.</p>
    <form id="kwform" class="controls">
      <input id="kwq" type="search" placeholder="موضوع یا کلمه" aria-label="موضوع یا کلمه" value="${esc(kwSeed)}" maxlength="80" required style="flex:1;min-width:120px" />
      <button class="btn" type="submit">جستجو</button>
      <div class="seg" id="kwmode" role="group" aria-label="نوع عبارت">${Object.entries({ focus: "پرسشی و اطلاعاتی", all: "همه" }).map(([v, t]) =>
        `<button type="button" data-mode="${v}" class="${v === kwMode ? "on" : ""}" aria-pressed="${v === kwMode}">${t}</button>`).join("")}</div>
    </form>
    <div id="list"></div>`;
  const list = document.getElementById("list");
  // Chrome's permission prompt is in English and names a host the user never heard of: said beforehand, until granted
  chrome.permissions.contains({ origins: [SUGGEST_ORIGIN] }).then((granted) => {
    const note = document.getElementById("kwperm");
    if (note) note.hidden = granted;
  }).catch(() => {});
  const render = () => {
    const shown = kwRows.filter((r) => kwMode === "all" || r.type !== "other");
    setExport(`کلمات پرجستجو ${kwSeed}`, ["عبارت", "نوع", "جستجوی ماهانه"], shown.map((r) => [r.keyword, KW_TYPES[r.type], r.volume ?? ""]));
    list.innerHTML = kwNote + (shown.length ? `<p class="muted">${fa(shown.length)} عبارت از ${fa(kwRows.length)} عبارتی که گوگل برای «${esc(kwSeed)}» پیشنهاد می‌دهد، پرجستجوترین اول. «—» یعنی جت‌سئو هنوز حجم جستجوی آن عبارت را ندارد (عبارت تازه یا کم‌جستجو).</p>
      <section class="card"><table class="kw"><thead><tr><th>عبارت</th><th>نوع</th><th class="num">جستجوی ماهانه</th><th aria-label="خبرهای این عبارت"></th></tr></thead><tbody>${shown.map((r) => `<tr>
        <td><a href="https://www.google.com/search?q=${encodeURIComponent(r.keyword)}&hl=fa" target="_blank" rel="noopener" dir="auto">${esc(r.keyword)}</a></td>
        <td><span class="badge ${r.type === "question" ? "watch" : r.type === "info" ? "tg" : ""}">${KW_TYPES[r.type]}</span></td>
        <td class="num">${r.volume == null ? "—" : fa(r.volume)}</td>
        <td><a href="${newsUrl(r.keyword)}" target="_blank" rel="noopener">خبرها</a></td></tr>`).join("")}</tbody></table></section>`
      : `<div class="empty">${kwRows.length ? `برای «${esc(kwSeed)}» عبارت پرسشی یا اطلاعاتی پیدا نشد؛ «همه» را ببینید.` : `گوگل برای «${esc(kwSeed)}» عبارتی پیشنهاد نمی‌دهد. املای آن را بررسی کنید یا کلمه کوتاه‌تر و کلی‌تری بنویسید.`}</div>`);
  };
  document.getElementById("kwmode").onclick = (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === kwMode) return;
    kwMode = b.dataset.mode;
    for (const x of e.currentTarget.children) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }
    if (kwRows) render();
  };
  document.getElementById("kwform").onsubmit = async (e) => {
    e.preventDefault();
    const seed = document.getElementById("kwq").value.replace(/\s+/g, " ").trim();
    // at least a letter or digit: punctuation alone folds to nothing, which every phrase «holds»
    if (newsFold(seed).length < 2) return;
    // in the submit's user gesture, before anything is awaited; true at once when already granted
    const allowed = chrome.permissions.request({ origins: [SUGGEST_ORIGIN] }).catch(() => false);
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    setExport(null);
    if (!(await allowed)) {
      button.disabled = false;
      list.innerHTML = `<div class="empty">عبارت‌ها از پیشنهادهای جستجوی گوگل خوانده می‌شوند؛ بدون اجازه دسترسی به آن نشان داده نمی‌شوند.</div>`;
      return;
    }
    document.getElementById("kwperm").hidden = true;
    list.innerHTML = `<div class="empty" id="kwwait" aria-live="off">در حال خواندن پیشنهادهای گوگل…</div>`;
    const ideas = await keywordIdeas(seed, (done, all) => {
      const wait = document.getElementById("kwwait");
      if (wait && id === loadId) wait.textContent = `در حال خواندن پیشنهادهای گوگل… ${fa(done)} از ${fa(all)}`;
    });
    // the seed alone is always there: more than it means Google answered
    const res = ideas.length > 1 ? await newsApi("keywords", "POST", ideas) : { status: 200, data: { keywords: [] } };
    if (res.status === 401) return signedOut();
    // a search left behind (another list is open now) must not load the app again over it
    if (res.status === 403) {
      if (id === loadId) start();
      return;
    }
    const known = new Map((res.data?.keywords ?? []).map((k) => [k.keyword, k]));
    kwSeed = seed;
    // an older server has no api/News/keywords: the phrases still show, without their searches
    kwNote = res.status === 200 ? "" : `<div class="stale">حجم جستجوی عبارت‌ها از سرور جت‌سئو خوانده نشد؛ فهرست بدون آن نمایش داده می‌شود. کمی بعد دوباره جستجو کنید.</div>`;
    kwRows = (ideas.length > 1 ? ideas : []).map((keyword) => ({ keyword, volume: known.get(keyword)?.volume ?? null, type: keywordType(keyword, known.get(keyword)?.informational) }))
      // the most searched first; a phrase without a known volume after those with one, questions before the rest
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || (a.type === "question" ? 0 : 1) - (b.type === "question" ? 0 : 1));
    // the view was drawn again while Google answered (⟳, or away and back): it draws once more, with these rows
    if (id !== loadId) { if (tab === "keywords") show("keywords"); return; }
    button.disabled = false;
    render();
  };
  if (kwRows) render();
}

// «رو به رشد»: read at least twice as much as the day before and the week before; «ویرایش داغ»: articles several people
// edited in the last 3 hours, where a death or an event shows before it shows in the reads.
let wikiMode = "rising";
const wikiLink = (title) => `https://fa.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
// Google News has no Iran edition (hl=fa&gl=IR falls back to US English), so the news tab of Google Search, last week
const newsUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&hl=fa&gl=ir&tbs=qdr:w`;
const newsLink = (q) => `<a href="${newsUrl(q)}" target="_blank" rel="noopener">چرا؟ خبرها</a>`;

async function showWiki(id) {
  const modes = { rising: "رو به رشد", top: "پربازدیدترین", edits: "ویرایش داغ", missing: "انگلیسی، بدون فارسی" };
  const mode = wikiMode;
  modeBar(modes, mode, (v) => { wikiMode = v; show("wiki"); });
  const list = document.getElementById("list");
  const data = await freeApi(id, `wiki?mode=${mode}`, "آمار ویکی‌پدیا", list);
  if (!data) return;
  if (mode === "missing") {
    countOnce("wiki-missing");
    // English Wikipedia's most-read articles with no Persian one: what the world reads about and Persian has not caught up with
    const items = data.items ?? [];
    const date = new Date(data.day).toLocaleDateString("fa-IR", { timeZone: "UTC" });
    const enLink = (article) => `https://en.wikipedia.org/wiki/${encodeURIComponent(article)}`;
    setExport("ویکی‌پدیا انگلیسی بدون فارسی", ["مقاله", "بازدید", "لینک"], items.map((a) => [a.article.replace(/_/g, " "), a.views, enLink(a.article)]));
    list.innerHTML = `<p class="muted">پربازدیدترین مقاله‌های ویکی‌پدیای انگلیسی در ${esc(date)} که مقاله فارسی ندارند: فیلم، آدم یا رویدادی که دنیا درباره‌اش می‌خواند و هنوز به فارسی نیامده است.</p>` +
      (items.length ? items.map((a) => `<article class="card">
      <h3 dir="ltr" lang="en" style="text-align:left"><a href="${enLink(a.article)}" target="_blank" rel="noopener">${esc(a.article.replace(/_/g, " "))}</a></h3>
      <div class="meta"><span class="badge">${fa(a.views)} بازدید</span>
        <a href="${esc(translateUrl(enLink(a.article)))}" target="_blank" rel="noopener">ترجمه مقاله</a>
        ${newsLink(a.article.replace(/_/g, " "))}</div>
    </article>`).join("") : `<div class="empty">همه مقاله‌های پربازدید انگلیسی این روز، مقاله فارسی دارند.</div>`);
  } else if (mode === "edits") {
    const edits = data.edits ?? [];
    setExport("ویکی‌پدیا ویرایش داغ", ["مقاله", "ویرایشگر", "ویرایش", "لینک"], edits.map((p) => [p.title, p.editors, p.edits, wikiLink(p.title)]));
    list.innerHTML = `<p class="muted">مقاله‌هایی از ویکی‌پدیای فارسی که در ۳ ساعت اخیر چند نفر ویرایششان کرده‌اند (بدون ربات‌ها).</p>` +
      (edits.length ? edits.map((p) => `<article class="card">
      <h3><a href="${wikiLink(p.title)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge ${p.editors >= 4 ? "late" : "watch"}">${fa(p.editors)} ویرایشگر</span><span>${fa(p.edits)} ویرایش</span>
        <a href="${wikiLink(p.title)}?action=history" target="_blank" rel="noopener">تاریخچه</a> ${newsLink(p.title)}</div>
    </article>`).join("") : `<div class="empty">در ۳ ساعت اخیر مقاله‌ای ویرایش همزمان نداشته است.</div>`);
  } else {
    const items = data.items ?? [];
    const date = new Date(data.day).toLocaleDateString("fa-IR", { timeZone: "UTC" });
    setExport(mode === "top" ? "ویکی‌پدیا پربازدیدترین" : "ویکی‌پدیا رو به رشد", ["مقاله", "بازدید", "بازدید روز قبل یا هفته قبل", "لینک"],
      items.map((a) => [a.article.replace(/_/g, " "), a.views, a.base ?? "", wikiLink(a.article)]));
    list.innerHTML = `<p class="muted">${mode === "top" ? "پربازدیدترین" : "مقاله‌هایی از ویکی‌پدیای فارسی که بازدیدشان دست‌کم دو برابر دیروز و هفته پیش شده،"} در ${esc(date)}.</p>` +
      (items.length ? items.map((a) => {
        const title = a.article.replace(/_/g, " ");
        return `<article class="card">
      <h3><a href="${wikiLink(a.article)}" target="_blank" rel="noopener">${esc(title)}</a></h3>
      <div class="meta"><span class="badge">${fa(a.views)} بازدید</span>
        ${a.views >= 2 * a.base ? `<span class="badge watch">${fa(Math.round(a.views / a.base))} برابر</span>` : ""}
        ${newsLink(title)}</div>
    </article>`;
      }).join("") : `<div class="empty">مقاله‌ای با جهش بازدید نیست.</div>`);
  }
}

// «مناسبت‌ها»: events, births and deaths of the solar day with how many years ago, round anniversaries (every 5 years)
// first, and the occasions of the Gregorian day; from Wikipedia's day pages.
let dayOffset = 1;

async function showDays(id) {
  modeBar({ 0: "امروز", 1: "فردا", 2: "پس‌فردا" }, String(dayOffset), (v) => { dayOffset = +v; show("days"); });
  const list = document.getElementById("list");
  const data = await freeApi(id, `days?offset=${dayOffset}`, "مناسبت‌های این روز", list);
  if (!data) return;
  const label = { "رویدادها": "رویداد", "زادروزها": "زادروز", "درگذشت‌ها": "درگذشت" };
  const row = (e) => `<li>${esc(e.what)} <span class="muted">· ${label[e.section] ?? ""} · ${e.ago % 5 ? `${fa(e.ago)} سال پیش` : `<b>${fa(e.ago)}امین سالگرد</b>`}</span></li>`;
  const entries = data.entries ?? [];
  const card = (title, body) => body ? `<section class="card"><h3>${title}</h3><ul style="margin:0;padding-inline-start:16px">${body}</ul></section>` : "";
  setExport(`مناسبت‌ها ${data.solar ?? ""}`, ["مناسبت", "نوع", "چند سال پیش"], [
    ...(data.occasions ?? []).map((o) => [o, "مناسبت جهانی", ""]),
    ...[...entries].sort((a, b) => (a.ago % 5 ? 1 : 0) - (b.ago % 5 ? 1 : 0)).map((e) => [e.what, label[e.section] ?? "", e.ago])]);
  list.innerHTML = `<p class="muted">${esc(data.solar)} (${esc(data.gregorian)}) از ویکی‌پدیای فارسی:
      <a href="${wikiLink(data.solar)}" target="_blank" rel="noopener">${esc(data.solar)}</a> و <a href="${wikiLink(data.gregorian)}" target="_blank" rel="noopener">${esc(data.gregorian)}</a></p>` +
    card("سالگردهای رُند", entries.filter((e) => e.ago % 5 === 0).map(row).join("")) +
    card("مناسبت‌های جهانی", (data.occasions ?? []).map((o) => `<li>${esc(o)}</li>`).join("")) +
    ["رویدادها", "زادروزها", "درگذشت‌ها"].map((s) => card(s, entries.filter((e) => e.section === s && e.ago % 5).map(row).join(""))).join("");
}

// «تلگرام» (with the module): mode "only", stories only Telegram channels have told so far; mode "trend", the posts
// spreading fastest for their channel (api/News/telegram). The channels are read on the server, through ai.jetseo.ir.
let telegramMode = "only";

async function showTelegram(id) {
  const prefs = await newsPrefs();
  const modes = { only: "فقط در تلگرام", trend: "ترند تلگرام" };
  modeBar(modes, telegramMode, (v) => { telegramMode = v; show("telegram"); },
    hoursHtml(prefs));
  wireHours("telegram");
  const mode = telegramMode;
  const res = await newsApi(`telegram?mode=${mode}&hours=${prefs.hours}`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  if (mode === "trend") {
    const posts = (res.data.posts ?? []).filter((p) => !prefs.muted.includes(String(p.domain ?? "").toLowerCase()))
      .map((p) => newsWithWatch(p, prefs))
      .filter((p) => !newsFocused(prefs) || p.watch);
    setExport("ترند تلگرام", ["پست", "کانال", "بازدید", "بازدید در ساعت", "برابر معمول کانال", "زمان", "لینک"],
      posts.map((p) => [p.title, p.channel, p.views, p.perHour, p.relative, csvTime(p.at), p.url]));
    list.innerHTML = staleNote(res.data) + `<p class="muted">پست‌هایی که بازدیدشان از معمولِ همان کانال تندتر بالا می‌رود.</p>` + (posts.length ? posts.map((p) => `<article class="card">
      <h3><a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge late">${fa(p.relative)} برابر معمول کانال</span><span class="badge">${fa(p.perHour)} بازدید در ساعت</span>
        ${p.watch ? watchBadge(p) : ""}
        <span>${esc(p.channel)} · ${fa(p.views)} بازدید · ${ago(p.at, res.data.now)}</span></div>
    </article>`).join("") : `<div class="empty">${emptyText(prefs, "هنوز پستی دو بار خوانده نشده است؛ چند دقیقه بعد دوباره ببینید.")}</div>`);
    return;
  }
  const stories = newsPersonal(res.data.stories, prefs);
  setExport("فقط در تلگرام", STORY_HEADER, stories.map((s) => storyRow(s)));
  // the owner asks for the channels of the team's field in the panel («سایت و رقبا»); JetSEO adds them after a look
  const own = state?.access?.role === "owner" ? ` <a href="${safeUrl((state?.panelUrl ?? "") + "?tab=sites")}" target="_blank" rel="noopener">پیشنهاد کانال تلگرام حوزه خودتان در پنل</a>` : "";
  list.innerHTML = staleNote(res.data) + `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minChannels)} کانال تلگرام گفته‌اند و هنوز هیچ سایتی نه.${own}</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now)).join("") : `<div class="empty">${emptyText(prefs, "در این بازه سوژه‌ای فقط در تلگرام نیست.")}</div>`);
}

// «کار شده»: stories with a media item on some site, most media first; «فرصت»: stories at least MEDIA_CHANCE_SITES
// sites told with no media item yet, the ones a multimedia desk can still be first on.
const MEDIA_CHANCE_SITES = 3;
let mediaMode = "made";

async function showMedia(id) {
  const prefs = await newsPrefs();
  modeBar({ made: "کار شده", chance: "فرصت" }, mediaMode, (v) => { mediaMode = v; show("media"); },
    hoursHtml(prefs));
  wireHours("media");
  const mode = mediaMode;
  const res = await newsApi(`topics?hours=${prefs.hours}&minSources=1`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = loadFailed(res); return; }
  const now = res.data.now;
  const stories = newsPersonal(res.data.stories, prefs).map((s) => ({
    ...s, media: s.items.filter((i) => !i.telegram).map((i) => ({ ...i, kind: mediaKind(i) })).filter((i) => i.kind),
  }));
  if (mode === "chance") {
    const open = stories.filter((s) => s.sources >= MEDIA_CHANCE_SITES && !s.media.length);
    setExport("چندرسانه‌ای فرصت", STORY_HEADER, open.map((s) => storyRow(s)));
    list.innerHTML = `<p class="muted">سوژه‌هایی که دست‌کم ${fa(MEDIA_CHANCE_SITES)} سایت کار کرده‌اند و در تیترهایشان هنوز ویدئو، عکس، اینفوگرافیک یا صوتی نیست.</p>` +
      (open.length ? open.map((s) => storyCard(s, now)).join("") : `<div class="empty">${emptyText(prefs, "در این بازه سوژه پرمنبعی بی‌چندرسانه‌ای نیست.")}</div>`);
    return;
  }
  const made = stories.filter((s) => s.media.length).sort((a, b) => b.media.length - a.media.length || b.sources - a.sources);
  setExport("چندرسانه‌ای کار شده", [...STORY_HEADER, "چندرسانه‌ای‌ها"], made.map((s) => storyRow(s, [s.media.map((i) => `${MEDIA_KINDS[i.kind]}: ${i.source} ${i.url}`).join(" | ")])));
  const badges = (media) => Object.entries(media.reduce((n, i) => ({ ...n, [i.kind]: (n[i.kind] ?? 0) + 1 }), {}))
    .map(([kind, c]) => `<span class="badge media">${MEDIA_KINDS[kind]} ${fa(c)}</span>`).join("");
  const rows = (media) => `<ul class="list">${media.map((i) => `<li><span class="badge media">${MEDIA_KINDS[i.kind]}</span>
    <a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("")}</ul>`;
  list.innerHTML = `<p class="muted">سوژه‌هایی که رسانه‌ها برایشان ویدئو، عکس، اینفوگرافیک یا صوت منتشر کرده‌اند (از روی تیتر و آدرس هر مطلب).</p>` +
    (made.length ? made.map((s) => storyCard(s, now, { meta: badges(s.media), body: rows(s.media) })).join("") : `<div class="empty">${emptyText(prefs, "در این بازه مطلب چندرسانه‌ای پیدا نشد.")}</div>`);
}

const promptButton = (s, kind) =>
  `<button class="btn ghost small" type="button" data-copy="${esc(storyPrompt(s, kind))}"${kind === "update" ? "" : " data-formats"} title="${PROMPT_KINDS[kind].hint}">پرامپت</button>`;

// the card's copy carries the answers of «مردم چه می‌پرسند؟» too: in their place in a story's prompt, at the end of a
// trend's brief
function addAngles(card, angles) {
  const copy = card.querySelector("button[data-copy]");
  if (!copy || !angles.length) return;
  const list = angles.map((s) => `- ${s}`).join("\n");
  copy.dataset.copy = copy.dataset.copy.includes(NO_ANGLES) ? copy.dataset.copy.replace(NO_ANGLES, () => list) : `${copy.dataset.copy}\nمردم این‌ها را هم جستجو می‌کنند:\n${list}`;
}

// A copy button (a story's prompt, a trend's brief), or one of the other outputs of a story's prompt (data-format).
// Those show under the card the first time its prompt is copied.
main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy], button[data-format]");
  if (!b) return;
  const card = b.closest(".card");
  const label = (b.dataset.label ??= b.textContent);
  // another output is made of the card's prompt as it is now (the angles may have joined it since it was drawn)
  const text = b.dataset.format ? promptAs(card.querySelector("button[data-copy]").dataset.copy, b.dataset.format) : b.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
    b.textContent = "کپی شد";
  } catch (error) {
    b.textContent = "کپی نشد";
  }
  setTimeout(() => { b.textContent = label; }, 2000);
  if ("formats" in b.dataset && !card.querySelector(".formats")) {
    card.querySelector(".angles").insertAdjacentHTML("beforebegin", `<div class="formats"><div class="sub">همین پرامپت با خروجی دیگر</div><div class="chips">${
      Object.entries(PROMPT_FORMATS).map(([id, f]) => `<button class="chip" type="button" data-format="${id}" title="پرامپت همین سوژه کپی می‌شود، با خروجی «${f.label}» به جای مطلب">${f.label}</button>`).join("")}</div></div>`);
  }
});

// «مردم چه می‌پرسند؟» of a story: Google's suggestions for its trend, or for its headline cut shorter until Google knows it
// (a whole headline rarely has any). Asked only on the click: a list of stories would be a burst of requests.
main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-angles]");
  if (!b) return;
  // in the click's user gesture, before anything is awaited; true at once when already granted
  const allowed = chrome.permissions.request({ origins: [SUGGEST_ORIGIN] }).catch(() => false);
  const card = b.closest(".card");
  b.disabled = true;
  b.textContent = "در حال یافتن…";
  if (!(await allowed)) {
    b.disabled = false;
    b.textContent = "مردم چه می‌پرسند؟";
    card.querySelector(".angles").innerHTML = `<div class="muted">این پیشنهادها از جستجوی گوگل خوانده می‌شوند؛ بدون اجازه دسترسی به آن نشان داده نمی‌شوند.</div>`;
    return;
  }
  const words = b.dataset.angles.split(/\s+/).filter(Boolean);
  let q = "", angles = [];
  for (q of new Set([words.length, 6, 4, 3].map((n) => words.slice(0, n).join(" ")))) {
    angles = await suggestions(q);
    if (angles.length) break;
  }
  card.querySelector(".angles").innerHTML = angles.length ? angleChips(angles, q) : `<div class="muted">گوگل برای این سوژه جستجوی مرتبطی پیشنهاد نمی‌دهد.</div>`;
  b.hidden = true;
  addAngles(card, angles);
});

// «رد شد» on a gap story: gone from the list and the alerts, with a way back until the list is drawn again.
main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-skip]");
  if (!b) return;
  const card = b.closest(".card");
  const key = b.dataset.skip;
  // for the whole team too (api/News/mark; key = «site:story»): its other members stop seeing and being alerted of the
  // story. Not waited for: the local skip below already holds here, also with a server that has no marks yet.
  const mark = (status) => newsApi(`mark?storyId=${encodeURIComponent(key.split(":")[1])}&status=${status}`, "POST");
  mark("dismissed");
  await newsSetSkipped(key, true);
  card.hidden = true;
  const undo = document.createElement("div");
  undo.className = "card muted";
  undo.innerHTML = `«${esc(card.querySelector("h3").textContent)}» کنار گذاشته شد. <a href="#">برگردان</a>`;
  undo.querySelector("a").onclick = async (ev) => {
    ev.preventDefault();
    mark("none");
    await newsSetSkipped(key, false);
    undo.remove();
    card.hidden = false;
  };
  card.after(undo);
  // the button was hidden with its card: keyboard focus goes to the way back
  undo.querySelector("a").focus();
});

// «چه چیزی تازه است»: once after an update, what the new version added, until «فهمیدم». Shown to someone who used an
// earlier version (the background has run before: newsSeen), not on a first install.
const WHATS_NEW = {
  "0.10.0": [
    "«ساعت سکوت» در ⚙ تنظیمات: ساعت‌هایی که سر کار نیستید اعلانی نمی‌آید.",
    "اعلانِ یک سوژه دکمه «من می‌نویسم» دارد: بدون باز کردن برنامه سوژه را بردارید.",
    "صفحه‌کلید در فهرست سوژه‌ها: J و K بین سوژه‌ها، Enter باز کردن خبر، W «من می‌نویسم» و / جستجو.",
    "وقتی اینترنت قطع است فهرست همین را می‌گوید و با برگشتن اتصال خودش دوباره خوانده می‌شود.",
  ],
  "0.9.0": [
    "«کلمات پرجستجو» بخش تازه‌ای است: یک موضوع بنویسید و ببینید مخاطب درباره آن چه می‌پرسد و هر عبارت در ماه چند بار جستجو می‌شود؛ پرسشی‌ها و اطلاعاتی‌ها اول.",
    "«پرامپت» روی هر سوژه متنی آماده برای دستیار هوش مصنوعی کپی می‌کند: خواندن منابع، سه تیتر، لید و متن خبر. بعد از کپی، همان را برای پست تلگرام، تیتر دیسکاور یا پرسش و پاسخ هم می‌دهد.",
    "داشبورد کامل‌تر شد: «الان باید دید»، «تیم الان چه می‌نویسد»، پوشش به تفکیک میز و «مقایسه با رسانه‌های دیگر». «کپی گزارش شیفت» همه را به صورت متن برای گروه تحریریه کپی می‌کند.",
    "دکمه «⬇ اکسل» بالای صفحه، فهرستی را که می‌بینید (داشبورد، سوژه‌ها، شکاف پوشش، ترندها، کلمات پرجستجو و …) به صورت فایل CSV ذخیره می‌کند که در اکسل باز می‌شود.",
    "«بازه» برای داشبورد و همه فهرست‌های سوژه یکی شد، و در صفحه کامل همه فهرست‌ها در یک ستون کنار صفحه‌اند.",
    "کلیک روی هر اعلان، سوژه‌های همان اعلان را بالای فهرست نشان می‌دهد.",
    "«فقط سوژه‌های کلیدواژه‌های من» در ⚙ تنظیمات: موضوع‌هایی را که دنبال می‌کنید بنویسید تا همه فهرست‌های سوژه فقط همان‌ها را نشان دهند.",
    "نام چند دکمه روشن‌تر شد: «برداشتم» حالا «من می‌نویسم» است، «آزاد شد» شده «منصرف شدم» و «زاویه‌ها» شده «مردم چه می‌پرسند؟». راهنمای همه برچسب‌ها در ⚙ تنظیمات است.",
    "صاحب اشتراک می‌تواند در پنل جت‌سئو (سایت و رقبا) کانال‌های تلگرام حوزه خودش را هم، مثل سایت‌ها، به عنوان منبع پیشنهاد دهد.",
  ],
  "0.8.0": [
    "بخش‌ها چهار تا شدند: امروز، سوژه‌ها، ترندها و سایت ما. فهرست‌های هر بخش زیر آن است و تنظیمات به ⚙ بالای صفحه رفت.",
    "«رسانه‌های خارجی» در بخش سوژه‌ها: سوژه‌های داغ رسانه‌های انگلیسی‌زبان، با لینک خبر و ترجمه گوگل.",
    "«برداشتم» روی هر سوژه به تیم می‌گوید شما روی آن کار می‌کنید؛ «رد شد» برای همه تیم اعمال می‌شود.",
    "برچسب‌های «در سایت شما» و «منبع تازه»، و ترتیب «رو به رشد». کارهای دیگر هر سوژه (زاویه‌ها، کپی) زیر «⋯» است.",
    "فهرست‌هایی که لازم ندارید را در ⚙ تنظیمات بردارید.",
  ],
};
async function showWhatsNew() {
  const box = document.getElementById("whatsnew");
  const version = chrome.runtime.getManifest().version;
  const { newsVersionSeen, newsSeen } = await chrome.storage.local.get(["newsVersionSeen", "newsSeen"]).catch(() => ({}));
  const seen = () => chrome.storage.local.set({ newsVersionSeen: version }).catch(() => {});
  if (newsVersionSeen === version || !WHATS_NEW[version] || (!newsVersionSeen && !newsSeen?.started)) {
    box.hidden = true;
    if (newsVersionSeen !== version) seen();
    return;
  }
  box.hidden = false;
  box.innerHTML = `<strong>در این نسخه (${esc(version)}) چه چیزی تازه است</strong><ul>${WHATS_NEW[version].map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
    <button class="btn ghost small" type="button" id="whatsnew-ok">فهمیدم</button>`;
  document.getElementById("whatsnew-ok").onclick = () => { box.hidden = true; seen(); };
}

// the hours of «ساعت سکوت»
const hourOptions = (current) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === current ? "selected" : ""}>${fa(h)}</option>`).join("");

async function showSettings() {
  const prefs = await newsPrefs();
  const owner = state?.access?.role === "owner";
  main.innerHTML = `<section class="card">
      <h3>فیلترهای شخصی</h3>
      <p class="muted" style="margin:0">فقط برای خودتان. فیلترهای تیم (برای همه اعضا) در پنل جت‌سئو هستند${owner ? `: <a href="${safeUrl((state?.panelUrl ?? "") + "?tab=filters")}" target="_blank" rel="noopener">فیلترهای تیم</a>` : ""}.</p>
      <label for="excluded">کلمات مستثنی (با ویرگول جدا شوند؛ فقط کلمه کامل)</label>
      <textarea id="excluded">${esc(prefs.excluded.join("، "))}</textarea>
      <label for="watch">کلیدواژه‌های تحت نظر من (با ویرگول؛ فقط کلمه کامل). کنار کلیدواژه‌های تیم، برچسب و هشدار می‌گیرند. کلمه لاتین (مثل <span dir="ltr">OpenAI</span>) در سوژه‌های خارجی «رسانه‌های خارجی» هم هشدار می‌دهد.</label>
      <textarea id="watch">${esc(prefs.watch.join("، "))}</textarea>
      <label class="row"><input type="checkbox" id="watchOnly" ${prefs.watchOnly ? "checked" : ""}/> فقط سوژه‌های همین کلیدواژه‌ها را نشان بده</label>
      <p class="muted" style="margin:0">با این تیک، داشبورد، سوژه‌های داغ، شکاف پوشش، تلگرام، چندرسانه‌ای و رسانه‌های خارجی فقط سوژه‌هایی را می‌آورند که یکی از کلیدواژه‌های شما (یا تیم) در تیترشان هست؛ هشدار شکاف پوشش هم فقط برای همان‌ها می‌آید. ترندها و «مطالب ما» تغییر نمی‌کنند. بدون کلیدواژه، این تیک اثری ندارد.</p>
      <label for="muted">منابع بی‌صدا (دامنه، با ویرگول)</label>
      <textarea id="muted" dir="ltr">${esc(prefs.muted.join(", "))}</textarea>
      ${offeredTopics().length > 1 ? `<fieldset class="topics-pick"><legend>موضوع‌های من (میز شما در تحریریه؛ هیچ = همه${state.teamTopics?.length ? " موضوع‌های تیم" : ""})</legend>
        ${offeredTopics().map((t) => `<label class="row"><input type="checkbox" name="topic" value="${esc(t.key)}" ${prefs.topics.includes(t.key) ? "checked" : ""}/> ${esc(t.name)}</label>`).join("")}
        <p class="muted" style="margin:0">سوژه‌ای با کلیدواژه تحت نظر، از هر موضوعی باشد، نمایش داده می‌شود و هشدار می‌دهد.</p></fieldset>` : ""}
    </section>
    <section class="card">
      <h3>فهرست‌ها</h3>
      <p class="muted" style="margin:0">فهرست‌هایی که به کارتان نمی‌آید را بردارید تا بالای صفحه خلوت شود. داشبورد همیشه هست.</p>
      <div class="picks">${Object.keys(TAB_NAMES).filter((t) => t !== "dash" && (state?.access || FREE_TABS.includes(t)) && (t !== "global" || "foreignNews" in (state ?? {})))
        .map((t) => `<label class="row"><input type="checkbox" name="showtab" value="${t}" ${prefs.hiddenTabs.includes(t) ? "" : "checked"}/> ${TAB_NAMES[t]}</label>`).join("")}</div>
    </section>
    <section class="card">
      <h3>هشدارها</h3>
      <label class="row"><input type="checkbox" id="notifyGap" ${prefs.notifyGap ? "checked" : ""}/> سوژه‌ای که رقبا زده‌اند و ما نه</label>
      <label class="row"><input type="checkbox" id="notifyWatch" ${prefs.notifyWatch ? "checked" : ""}/> سوژه‌ای با کلیدواژه تحت نظر (تیم یا خودم)</label>
      <label class="row"><input type="checkbox" id="notifyUnclaimed" ${prefs.notifyUnclaimed ?? owner ? "checked" : ""}/> سوژه بی‌صاحب: شکاف پوشش یا کلیدواژه تحت نظری که بعد از ${fa(UNCLAIMED_MINUTES)} دقیقه هنوز کسی «من می‌نویسم» نزده (برای سردبیر و دبیر)</label>
      <label class="row">ساعت سکوت: از
        <select id="quietFrom" aria-label="شروع ساعت سکوت"><option value="">خاموش</option>${hourOptions(prefs.quietFrom)}</select> تا
        <select id="quietTo" aria-label="پایان ساعت سکوت">${hourOptions(prefs.quietTo ?? 7)}</select></label>
      <p class="muted" style="margin:0">در ساعت سکوت (به ساعت همین رایانه) اعلانی نمی‌آید و آنچه در آن فاصله آمده بعداً هم اعلان نمی‌شود؛ عدد روی آیکون و فهرست‌ها سر جایشان‌اند. اعلانِ یک سوژه دکمه «من می‌نویسم» دارد.</p>
      <p class="muted" style="margin:0">هر ۵ دقیقه بررسی می‌شود، تا وقتی کروم باز است.</p>
    </section>
    <section class="card">
      <h3>راهنمای برچسب‌ها و دکمه‌ها</h3>
      <ul class="list legend-list">
        <li><span class="badge">۵ منبع</span> چند سایت این سوژه را منتشر کرده‌اند.</li>
        <li><span class="badge new">۳ منبع تازه</span> سایت‌هایی که در یک ساعت اخیر به این سوژه پیوسته‌اند؛ یعنی سوژه در حال داغ شدن است.</li>
        <li><span class="badge new">جدید</span> از آخرین باری که فهرست را دیدید اضافه شده است.</li>
        <li><span class="badge watch">کلیدواژه: …</span> یکی از کلمه‌هایی که شما یا تیم دنبال می‌کنید در تیتر اصلی سوژه هست، یا در تیتر دست‌کم دو منبع؛ خود کلمه روی برچسب می‌آید.</li>
        <li><span class="badge ok">در سایت شما</span> سایت خودتان این سوژه را منتشر کرده است.</li>
        <li><span class="badge tg">اول در تلگرام</span> کانال‌های تلگرام زودتر از سایت‌ها این خبر را گفته‌اند.</li>
        <li><span class="badge tg">می‌نویسد: نام</span> یکی از اعضای تیم «من می‌نویسم» را زده و روی این سوژه کار می‌کند.</li>
        <li><b>من می‌نویسم</b> به تیم می‌گوید این سوژه با شماست تا دو نفر یک خبر را ننویسند؛ <b>منصرف شدم</b> آن را آزاد می‌کند.</li>
        <li><b>مردم چه می‌پرسند؟</b> چیزهایی که مخاطب همراه این سوژه در گوگل جستجو می‌کند؛ ایده تیتر و میان‌تیتر.</li>
        <li><b>پرامپت</b> یک پرامپت آماده کپی می‌کند تا به هوش مصنوعی بدهید، و خودش با سوژه جور می‌شود: برای سوژه تازه سه تیتر، لید و متن مطلب می‌خواهد؛ روی سوژه‌ای که «در سایت شما» هست می‌گوید چه چیزی به مطلبتان اضافه یا اصلاح شود (نشانی یا متن مطلب خودتان را در جای مشخص‌شده پرامپت بگذارید)؛ در «شکاف پوشش» زاویه‌ای می‌خواهد که رقبا نگفته‌اند؛ و در «رسانه‌های خارجی» از خبرهای انگلیسی مطلب فارسی. اگر اول «مردم چه می‌پرسند؟» را بزنید، آن پرسش‌ها هم در پرامپت می‌آیند. نشانگر را روی دکمه نگه دارید تا بگوید کدام است.</li>
        <li>بعد از کپی پرامپت (جز روی سوژه‌ای که «در سایت شما» هست)، زیر کارت سه خروجی دیگر برای همان سوژه می‌آید: <b>پست تلگرام</b>، <b>گوگل دیسکاور</b> (تیتر و توضیح) و <b>پرسش و پاسخ</b>.</li>
        <li><b>⬇ اکسل</b> (بالای صفحه) فهرستی را که می‌بینید به صورت فایل ذخیره می‌کند.</li>
      </ul>
    </section>
    <section class="card">
      <h3>میانبرها</h3>
      <p class="muted" style="margin:0">باز کردن جت‌سئو نیوز: <kbd id="shortcut">Alt+Shift+N</kbd> (<a href="#" id="shortcuts">تغییر</a>).
        روی صفحه یا لینکِ خبرهای سایت خودتان راست‌کلیک کنید: «بررسی سئوی این خبر».</p>
      <p class="muted" style="margin:0">در فهرست سوژه‌ها: <kbd>J</kbd> سوژه بعدی، <kbd>K</kbd> سوژه قبلی، <kbd>Enter</kbd> باز کردن خبر، <kbd>W</kbd> «من می‌نویسم» یا «منصرف شدم»، <kbd>/</kbd> جستجو در تیترها. با صفحه‌کلید فارسی هم همان کلیدها کار می‌کنند.</p>
    </section>
    <div class="savebar"><button class="btn" id="save" type="button">ذخیره تنظیمات</button> <span id="saved" class="muted" role="status" hidden>ذخیره شد.</span></div>`;
  // the shortcut actually set: the user may have changed it, and Chrome leaves the suggested one unset on a conflict
  chrome.commands.getAll().then((commands) => {
    document.getElementById("shortcut").textContent = commands.find((c) => c.name === "_execute_action")?.shortcut || "تعریف نشده";
  }).catch(() => {});
  // chrome:// pages open only through the tabs API
  document.getElementById("shortcuts").onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); };
  const list = (id) => document.getElementById(id).value.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
  document.getElementById("save").onclick = async () => {
    const quietFrom = document.getElementById("quietFrom").value;
    await saveNewsPrefs({
      excluded: list("excluded"),
      watch: list("watch"),
      watchOnly: document.getElementById("watchOnly").checked,
      muted: list("muted").map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")),
      ...(offeredTopics().length > 1 ? { topics: [...document.querySelectorAll("input[name=topic]:checked")].map((c) => c.value) } : {}),
      notifyGap: document.getElementById("notifyGap").checked,
      notifyWatch: document.getElementById("notifyWatch").checked,
      notifyUnclaimed: document.getElementById("notifyUnclaimed").checked,
      quietFrom: quietFrom === "" ? null : +quietFrom,
      quietTo: +document.getElementById("quietTo").value,
      hiddenTabs: [...document.querySelectorAll("input[name=showtab]:not(:checked)")].map((c) => c.value),
    });
    hiddenTabs = (await newsPrefs()).hiddenTabs;
    renderNav();
    const saved = document.getElementById("saved");
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 3000);
  };
}

// the background tells the panel when the sign-in hand-off finished, and where a click sent the app (before state,
// start() takes it)
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "news-account") start();
  if (message?.type === "news-go" && state) takeGo();
});

// the gap count from the background's last round, until the tab is opened
chrome.action.getBadgeText({}).then((text) => {
  gapBadge = tab === "gap" ? 0 : parseInt(text, 10) || 0;
  renderNav();
});

start();
// not while the user types in a field: the redraw would take the focus
setInterval(() => {
  // nor while the answers of «مردم چه می‌پرسند؟» are open on a card: the redraw would take them away. The other outputs
  // of a prompt (.formats) do not hold it back: copying a prompt is what a card is for, and the list would stop
  // refreshing after the first one; they come back with the next copy.
  if (state?.access && ["dash", "topics", "gap"].includes(tab) && !document.activeElement?.matches("input, textarea, select")
    && !main.querySelector(".angles:not(:empty)")) show(tab);
}, 3 * 60 * 1000);
