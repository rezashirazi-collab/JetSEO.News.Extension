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

const fa = (n) => Number(n).toLocaleString("fa-IR");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");

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

function setBanner(html, bad = false) {
  banner.hidden = !html;
  banner.className = bad ? "bad" : "";
  banner.innerHTML = html ?? "";
}

async function start() {
  const account = await newsAccount();
  if (!account) return signedOut();
  main.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  const res = await newsApi("state");
  if (res.status === 401) return signedOut();
  if (res.status !== 200) {
    tabsNav.hidden = true;
    main.innerHTML = `<div class="center"><p>اتصال به جت‌سئو برقرار نشد.</p><button class="btn ghost" id="retry" type="button">دوباره</button></div>`;
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
  tabsNav.hidden = false;
  for (const b of tabsNav.querySelectorAll("button")) b.hidden = !a && !FREE_TABS.includes(b.dataset.tab);
  if (!a) {
    if (!FREE_TABS.includes(tab)) tab = "dash";
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
  if (!(await takeGo())) show(tab);
}

// Where the background sent the app (a right-click or a notification's click): { tab, siteId, url }, url = a page to
// check. Taken once; false when there is none or its tab needs the module.
async function takeGo() {
  const { newsGo: go } = await chrome.storage.session.get("newsGo").catch(() => ({}));
  if (!go?.tab) return false;
  await chrome.storage.session.remove("newsGo");
  if (!state?.access && !FREE_TABS.includes(go.tab)) return false;
  let host = "";
  try { host = new URL(go.url).hostname.toLowerCase(); } catch (error) {}
  const site = (state.sites ?? []).find((s) => {
    const d = String(s.domain).toLowerCase().replace(/^www\./, "");
    return s.id === go.siteId || (host && (host === d || host.endsWith(`.${d}`)));
  });
  if (site) gapSite = site.id;
  pendingCheck = go.url ?? null;
  show(go.tab);
  return true;
}

function signedOut() {
  state = null;
  tabsNav.hidden = true;
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

function show(name) {
  tab = name;
  for (const b of tabsNav.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === name);
  const id = ++loadId;
  ({ dash: showDash, topics: showTopics, gap: showGap, mine: showMine, trends: showTrends, wiki: showWiki, days: showDays, telegram: showTelegram, media: showMedia, settings: showSettings })[name](id);
}

tabsNav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) show(b.dataset.tab);
});
document.getElementById("refresh").onclick = () => start();

// This page is the full-page view (opened as panel.html?view=tab) or the side panel. The header switch moves to the
// other view and keeps it as the icon's default.
const pageView = new URLSearchParams(location.search).get("view") === "tab" ? "tab" : "panel";
document.body.classList.toggle("page", pageView === "tab");
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
function storyCard(s, now, extra = "", body = "") {
  const items = (s.items ?? []).map((i) =>
    `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${i.telegram ? "تلگرام · " : ""}${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("");
  return `<article class="card${s.fresh ? " fresh" : ""}">
    <h3>${esc(s.title)}</h3>
    <div class="meta">
      ${s.fresh ? `<span class="badge new">جدید</span>` : ""}
      ${s.sources ? `<span class="badge">${fa(s.sources)} منبع</span>` : ""}
      ${s.channels ? `<span class="badge">${fa(s.channels)} کانال</span>` : ""}
      ${s.telegramLead > 0 ? `<span class="badge tg">اول در تلگرام · ${duration(s.telegramLead)} زودتر</span>` : ""}
      ${s.watch ? `<span class="badge watch">کلیدواژه تحت نظر</span>` : ""}
      ${s.trend ? `<span class="badge trend">ترند ${esc(s.trend.source)}: ${esc(s.trend.text)}</span>` : ""}
      <span>اولین: ${esc(s.firstSource)} · ${ago(s.firstAt, now)}</span>
      ${extra}
      <button class="btn ghost small" type="button" data-angles="${esc(s.trend?.text ?? s.title)}" title="آنچه مخاطب همراه این سوژه جستجو می‌کند">زاویه‌ها</button>
      <button class="btn ghost small" type="button" data-copy="${esc(storyText(s))}" title="کپی برای پیام‌رسان">کپی</button>
    </div>
    ${body}
    <div class="angles"></div>
    <details><summary>تیترها (${fa(s.items?.length ?? 0)})</summary><ul>${items}</ul></details>
  </article>`;
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
async function showDash(id) {
  // the 3-minute refresh keeps the old dashboard until the new one is ready: no flash, no jump to the top
  if (!main.querySelector(".tiles")) main.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  const prefs = await newsPrefs();
  const a = state?.access;
  const sites = state?.sites ?? [];
  const pick = (ok) => sites.find((s) => s.id === gapSite && ok(s)) ?? sites.find(ok);
  const gapS = pick((s) => s.hasFeed && s.competitors);
  const mineS = pick((s) => s.hasFeed);
  const get = (path) => newsApi(path).then((r) => (r.status === 200 ? r.data : null));
  const [topics, gap, tg, mine, google, wiki, days] = await Promise.all([
    a && get(`topics?hours=${prefs.topicHours}&minSources=${prefs.minSources}`),
    a && gapS && get(`gap?siteId=${gapS.id}&hours=${prefs.gapHours}`),
    a && get(`telegram?mode=only&hours=${prefs.telegramHours}`),
    a && mineS && get(`mine?siteId=${mineS.id}&hours=24`),
    get("google"), get("wiki?mode=rising"), get("days?offset=0"),
  ]);
  const skipped = await newsSkipped();
  if (id !== loadId) return;
  if (!(await newsAccount())) return signedOut();

  const hot = topics ? newsPersonal(topics.stories, prefs) : null;
  const gaps = gap ? newsPersonal(gap.stories, prefs).filter((s) => !skipped.has(`${gapS.id}:${s.id}`)) : null;
  const tgOnly = tg ? newsPersonal(tg.stories, prefs) : null;
  const trends = google?.trends ?? null;
  const rising = wiki ? (wiki.items ?? []).filter((x) => x.base > 0).map((x) => ({ ...x, ratio: x.views / x.base })).sort((x, y) => y.ratio - x.ratio) : null;
  const round = days ? (days.entries ?? []).filter((e) => e.ago % 5 === 0) : null;
  const mineItems = mine?.items ?? [];
  const first = mineItems.filter((i) => i.lagMinutes != null && i.lagMinutes <= 0).length;
  const late = mineItems.filter((i) => i.lagMinutes > 0);
  const none = mineItems.length - first - late.length;
  const count = (list) => (list ? fa(list.length) : "—");

  const tiles = (a ? [
    tile("topics", count(hot), `سوژه داغ (${fa(prefs.topicHours)} ساعت)`),
    tile("gap", gapS ? count(gaps) : "—", "شکاف پوشش", gaps?.length ? "bad" : "ok"),
    tile("telegram", count(tgOnly), "فقط در تلگرام"),
    tile("mine", mine && first + late.length ? `${fa(Math.round((100 * first) / (first + late.length)))}٪` : "—", "اول منتشر کردید"),
  ] : []).concat([
    tile("trends", count(trends), "ترند گوگل"),
    tile("wiki", count(rising), "ویکی رو به رشد"),
    tile("days", count(round), "سالگرد رُند امروز"),
  ]).join("");

  const median = late.length ? late.map((i) => i.lagMinutes).sort((x, y) => x - y)[Math.floor(late.length / 2)] : 0;
  const speed = mineItems.length ? `<div class="stack"><i class="s-ok" style="flex:${first}"></i><i class="s-late" style="flex:${late.length}"></i><i class="s-none" style="flex:${none}"></i></div>
    <div class="legend"><span><i class="s-ok"></i>اول شما ${fa(first)}</span><span><i class="s-late"></i>بعد از رقبا ${fa(late.length)}</span><span><i class="s-none"></i>رقیبی نزده ${fa(none)}</span></div>
    ${late.length ? `<p class="muted" style="margin:4px 0 0">تأخیر میانه: ${duration(median)}</p>` : ""}` : "";

  main.innerHTML = staleNote(topics) + `<div class="tiles">${tiles}</div><div class="dash-grid">` +
    section(`سوژه‌های داغ رسانه‌ها`, "topics", hot && bars(hot.slice(0, 5).map((s) => ({ label: s.title, href: s.items?.[0]?.url, value: s.sources, text: `${fa(s.sources)} منبع` })))) +
    section(`شکاف پوشش ${gapS ? `<span class="muted" dir="ltr">${esc(gapS.domain)}</span>` : ""}`, "gap", gaps?.length && `<ul class="list">${gaps.slice(0, 3).map((s) =>
      `<li><a href="${safeUrl(s.items?.[0]?.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">رقبا: ${esc((s.competitors ?? []).join("، "))}</span></li>`).join("")}</ul>`) +
    section(`سرعت انتشار ما (۲۴ ساعت)`, "mine", speed) +
    section("ترندهای گوگل", "trends", trends && bars(trends.slice(0, 6).map((t) => ({ label: t.title, href: newsUrl(t.title), value: trafficNumber(t.traffic), text: t.traffic ? esc(t.traffic) : "" })))) +
    section("ویکی‌پدیا: رو به رشد", "wiki", rising && bars(rising.slice(0, 5).map((x) => ({ label: x.article.replace(/_/g, " "), href: wikiLink(x.article), value: x.ratio, text: `${fa(Math.round(x.ratio))} برابر` })))) +
    section(`مناسبت‌های امروز${days?.solar ? ` (${esc(days.solar)})` : ""}`, "days", days && (round.length || days.occasions?.length) && `<ul class="list">${[
      ...(days.occasions ?? []).slice(0, 3).map((o) => `<li>${esc(o)}</li>`),
      ...round.slice(0, 4).map((e) => `<li>${esc(e.what)}: <span class="muted"><b>${fa(e.ago)}امین سالگرد</b></span></li>`)].join("")}</ul>`) + `</div>`;
}

const tile = (go, value, label, tone = "") => `<button class="tile ${tone}" type="button" data-go="${go}"><b>${value}</b><span>${label}</span></button>`;
const section = (title, go, body) => body ? `<section class="card"><h3 class="head"><span>${title}</span><a href="#" data-go="${go}">همه</a></h3>${body}</section>` : "";

// Horizontal bars, longest = the largest value. rows: { label, href, value, text }; text is already escaped.
function bars(rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.value || 0), 1);
  return `<div class="bars">${rows.map((r) => `<div class="bar-row">
      <a class="bar-label" href="${safeUrl(r.href)}" target="_blank" rel="noopener" title="${esc(r.label)}">${esc(r.label)}</a>
      <span class="bar"><i style="width:${Math.max(4, Math.round((100 * (r.value || 0)) / max))}%"></i></span>
      <span class="bar-val">${r.text}</span></div>`).join("")}</div>`;
}

// «20K+», «۲ هزار+» → a number for the bar's length; ponytail: Google's rounded buckets, good only for relative size
function trafficNumber(text) {
  const s = String(text ?? "").replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[,٬]/g, "");
  const m = s.match(/([\d.]+)\s*(k|m|هزار|میلیون)?/i);
  if (!m) return 0;
  return parseFloat(m[1]) * ({ k: 1e3, هزار: 1e3, m: 1e6, میلیون: 1e6 }[(m[2] ?? "").toLowerCase()] ?? 1);
}

main.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (!g) return;
  e.preventDefault();
  show(g.dataset.go);
});

// the search box's text, kept across the refreshes
let topicQuery = "";

async function showTopics(id) {
  const prefs = await newsPrefs();
  main.innerHTML = `<div class="controls">
      <label>بازه <select id="hours">${[1, 3, 6, 12].map((h) => `<option value="${h}" ${h === prefs.topicHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>
      <label>حداقل منبع <select id="min">${[2, 3, 5, 8].map((m) => `<option value="${m}" ${m === prefs.minSources ? "selected" : ""}>${fa(m)}</option>`).join("")}</select></label>
      <input id="q" type="search" placeholder="جستجو در تیترها" aria-label="جستجو در تیترها" value="${esc(topicQuery)}" style="flex:1;min-width:120px" />
    </div><div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  document.getElementById("hours").onchange = async (e) => { await saveNewsPrefs({ topicHours: +e.target.value }); show("topics"); };
  document.getElementById("min").onchange = async (e) => { await saveNewsPrefs({ minSources: +e.target.value }); show("topics"); };
  let stories = null, now = null, note = "";
  const list = document.getElementById("list");
  // any part of any headline, folded as the filters (ی/ي, digits, half-spaces)
  const render = () => {
    const q = newsFold(topicQuery);
    const shown = q ? stories.filter((s) => [s.title, ...s.items.map((i) => i.title)].some((t) => newsFold(t).includes(q))) : stories;
    list.innerHTML = note + (shown.length ? shown.map((s) => storyCard(s, now)).join("")
      : `<div class="empty">${q ? `سوژه‌ای با «${esc(topicQuery)}» نیست.` : "در این بازه سوژه‌ای با این تعداد منبع نیست."}</div>`);
  };
  document.getElementById("q").oninput = (e) => { topicQuery = e.target.value; if (stories) render(); };
  const res = await newsApi(`topics?hours=${prefs.topicHours}&minSources=${prefs.minSources}`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  stories = await markFresh(newsPersonal(res.data.stories, prefs));
  now = res.data.now;
  note = staleNote(res.data);
  if (id === loadId) render();
}

async function showGap(id) {
  const sites = state?.sites ?? [];
  const manage = `<a href="${safeUrl((state?.panelUrl ?? "") + "?tab=sites")}" target="_blank" rel="noopener">سایت و رقبا در پنل</a>`;
  if (!sites.length) {
    main.innerHTML = `<div class="center"><p>هنوز سایتی برای شکاف پوشش انتخاب نشده است.</p><p class="muted">${state?.access?.role === "owner" ? manage : "صاحب اشتراک باید سایت و رقبا را در پنل جت‌سئو انتخاب کند."}</p></div>`;
    return;
  }
  const prefs = await newsPrefs();
  main.innerHTML = `<div class="controls">
      ${sites.length > 1 ? `<select id="site" aria-label="سایت">${sites.map((s) => `<option value="${s.id}" ${s.id === gapSite ? "selected" : ""}>${esc(s.domain)}</option>`).join("")}</select>` : `<strong dir="ltr">${esc(sites[0].domain)}</strong>`}
      <label>بازه <select id="ghours">${[3, 6, 12, 24].map((h) => `<option value="${h}" ${h === prefs.gapHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>
    </div><div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  const siteSelect = document.getElementById("site");
  if (siteSelect) siteSelect.onchange = (e) => { gapSite = +e.target.value; show("gap"); };
  document.getElementById("ghours").onchange = async (e) => { await saveNewsPrefs({ gapHours: +e.target.value }); show("gap"); };
  const site = sites.find((s) => s.id === gapSite) ?? sites[0];
  const list = document.getElementById("list");
  if (!site.hasFeed) { list.innerHTML = `<div class="empty">فید سایت شما ثبت نشده؛ بدون آن شکاف پوشش محاسبه نمی‌شود. ${state.access.role === "owner" ? manage : ""}</div>`; return; }
  if (!site.competitors) { list.innerHTML = `<div class="empty">برای این سایت رقیبی انتخاب نشده است. ${state.access.role === "owner" ? manage : ""}</div>`; return; }
  const res = await newsApi(`gap?siteId=${site.id}&hours=${prefs.gapHours}`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  const skipped = await newsSkipped();
  if (id !== loadId) return;
  const key = (s) => `${site.id}:${s.id}`;
  const stories = newsPersonal(res.data.stories, prefs).filter((s) => !skipped.has(key(s)));
  list.innerHTML = staleNote(res.data) + `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minCompetitors)} رقیب از ${fa(res.data.competitors)} رقیب شما کار کرده‌اند و ${esc(res.data.site)} نه.</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now, `<span>رقبا: ${esc((s.competitors ?? []).join("، "))}</span>
      <button class="btn ghost small" type="button" data-skip="${esc(key(s))}" title="کار نمی‌کنیم؛ دیگر نه نشان داده شود نه هشدار">رد شد</button>`)).join("")
      : `<div class="empty">شکافی نیست؛ هرچه رقبا زده‌اند، شما هم زده‌اید.</div>`);
  chrome.runtime.sendMessage({ type: "news-gap-seen", ids: stories.map((s) => `${site.id}:${s.id}`) }).catch(() => {});
  document.getElementById("gap-count").hidden = true;
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
    main.innerHTML = `<div class="center"><p>هنوز سایتی انتخاب نشده است.</p></div>`;
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
  if (!site.hasFeed) { list.innerHTML = `<div class="empty">فید سایت شما ثبت نشده است.</div>`; return; }
  const res = await newsApi(`mine?siteId=${site.id}&hours=24`);
  if (id !== loadId) return;
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  const items = res.data.items ?? [];
  const covered = items.filter((i) => i.lagMinutes != null);
  const late = covered.filter((i) => i.lagMinutes > 0);
  const summary = covered.length
    ? `در ${fa(covered.length)} خبر که رقبا هم کار کردند، ${fa(covered.length - late.length)} بار اول شما بودید` +
      (late.length ? `؛ بقیه به‌طور میانه ${duration(late.map((i) => i.lagMinutes).sort((a, b) => a - b)[Math.floor(late.length / 2)])} دیرتر.` : ".")
    : "";
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
  const host = (d) => String(d ?? "").toLowerCase().replace(/^www\./, "");
  const ours = (i) => i.url === item.url || host(i.domain) === host(domain);
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

const TITLE_STOP = new Set("از به در با که را و یا این آن برای تا بر هم نیز ها های می است شد شده شود کرد کرده کند خود یک بود دارد".split(" "));

// The words at least half the other headlines (and at least 2) use and ours does not, most used first: [word, count].
// Folded as the filters, so «ي»/«ی» and half-spaces do not split a word; short words, stop words and numbers left out.
function headlineGap(ourTitle, otherTitles) {
  const words = (t) => new Set(newsFold(t).split(" ").filter((w) => w.length > 1 && !TITLE_STOP.has(w) && !/^\d+$/.test(w)));
  const ours = words(ourTitle);
  const counts = new Map();
  for (const t of otherTitles) for (const w of words(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const need = Math.max(2, Math.ceil(otherTitles.length / 2));
  return [...counts].filter(([w, c]) => c >= need && !ours.has(w)).sort((a, b) => b[1] - a[1]).slice(0, 8);
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
  if (res.status !== 200) { out.innerHTML = `<div class="empty">${what} بارگذاری نشد. کمی بعد ⟳ را بزنید.</div>`; return null; }
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
function angleChips(angles, base) {
  const short = (s) => s.replace(base, "").trim() || s;
  return `<div class="sub">زاویه‌ها (مخاطب این‌ها را هم جستجو می‌کند)</div><div class="chips">${angles.map((s) =>
    `<a class="chip" href="https://www.google.com/search?q=${encodeURIComponent(s)}&hl=fa" target="_blank" rel="noopener" title="${esc(s)}">${esc(short(s))}</a>`).join("")}</div>`;
}

// Google's autocomplete for a phrase: what readers search along with it, i.e. the angles worth writing.
// Google Search is not filtered in Iran, so it is read directly. The host permission is optional (a new required one
// would disable the extension on update until the user approves it): asked on the first «زاویه‌ها» click.
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
  // the brief for the team; «زاویه‌ها» adds the angles to it
  const brief = (t) => [`ترند گوگل: ${t.title}${t.traffic ? ` (${t.traffic} جستجو)` : ""}`,
    ...(t.news ?? []).slice(0, 3).map((x) => `خبر: ${x.title} ${x.url}`)].join("\n");
  main.innerHTML = `<p class="muted">جستجوهای داغ امروز گوگل در ایران، با خبرهایی که گوگل به هرکدام وصل کرده. «زاویه‌ها» چیزهایی است که مخاطب همراه آن جستجو می‌کند؛ هرکدام می‌تواند تیتر یا میان‌تیتر یک مطلب باشد.</p>` +
    (items.length ? items.map((t) => `<article class="card">
      <h3><a href="https://www.google.com/search?q=${encodeURIComponent(t.title)}&hl=fa" target="_blank" rel="noopener">${esc(t.title)}</a></h3>
      <div class="meta">${t.traffic ? `<span class="badge">${esc(t.traffic)} جستجو</span>` : ""}
        <a href="${newsUrl(t.title)}" target="_blank" rel="noopener">خبرهای فارسی</a>
        <button class="btn ghost small" type="button" data-angles="${esc(t.title)}" title="آنچه مخاطب همراه این ترند جستجو می‌کند">زاویه‌ها</button>
        <button class="btn ghost small" type="button" data-copy="${esc(brief(t))}" data-trend="1" title="کپی بریف برای تحریریه">کپی بریف</button></div>
      ${t.news?.length ? `<div class="sub">خبرهای مرتبط</div><ul class="muted" style="margin:0;padding-inline-start:16px">${t.news.map((x) => `<li><a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("")}</ul>` : ""}
      <div class="angles"></div>
    </article>`).join("") : `<div class="empty">ترندی نیست.</div>`);
}

// «رو به رشد»: read at least twice as much as the day before and the week before; «ویرایش داغ»: articles several people
// edited in the last 3 hours, where a death or an event shows before it shows in the reads.
let wikiMode = "rising";
const wikiLink = (title) => `https://fa.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
// Google News has no Iran edition (hl=fa&gl=IR falls back to US English), so the news tab of Google Search, last week
const newsUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&hl=fa&gl=ir&tbs=qdr:w`;
const newsLink = (q) => `<a href="${newsUrl(q)}" target="_blank" rel="noopener">چرا؟ خبرها</a>`;

async function showWiki(id) {
  const modes = { rising: "رو به رشد", top: "پربازدیدترین", edits: "ویرایش داغ" };
  const mode = wikiMode;
  modeBar(modes, mode, (v) => { wikiMode = v; show("wiki"); });
  const list = document.getElementById("list");
  const data = await freeApi(id, `wiki?mode=${mode}`, "آمار ویکی‌پدیا", list);
  if (!data) return;
  if (mode === "edits") {
    const edits = data.edits ?? [];
    list.innerHTML = `<p class="muted">مقاله‌هایی از ویکی‌پدیای فارسی که در ۳ ساعت اخیر چند نفر ویرایششان کرده‌اند (بدون ربات‌ها).</p>` +
      (edits.length ? edits.map((p) => `<article class="card">
      <h3><a href="${wikiLink(p.title)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge ${p.editors >= 4 ? "late" : "watch"}">${fa(p.editors)} ویرایشگر</span><span>${fa(p.edits)} ویرایش</span>
        <a href="${wikiLink(p.title)}?action=history" target="_blank" rel="noopener">تاریخچه</a> ${newsLink(p.title)}</div>
    </article>`).join("") : `<div class="empty">در ۳ ساعت اخیر مقاله‌ای ویرایش همزمان نداشته است.</div>`);
  } else {
    const items = data.items ?? [];
    const date = new Date(data.day).toLocaleDateString("fa-IR", { timeZone: "UTC" });
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
    `<label>بازه <select id="thours">${[3, 6, 12].map((h) => `<option value="${h}" ${h === prefs.telegramHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>`);
  document.getElementById("thours").onchange = async (e) => { await saveNewsPrefs({ telegramHours: +e.target.value }); show("telegram"); };
  const mode = telegramMode;
  const res = await newsApi(`telegram?mode=${mode}&hours=${prefs.telegramHours}`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  if (mode === "trend") {
    const posts = (res.data.posts ?? []).filter((p) => !prefs.muted.includes(String(p.domain ?? "").toLowerCase()))
      .map((p) => (!p.watch && newsWatched(p.title, prefs) ? { ...p, watch: true } : p));
    list.innerHTML = staleNote(res.data) + `<p class="muted">پست‌هایی که بازدیدشان از معمولِ همان کانال تندتر بالا می‌رود.</p>` + (posts.length ? posts.map((p) => `<article class="card">
      <h3><a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge late">${fa(p.relative)} برابر معمول کانال</span><span class="badge">${fa(p.perHour)} بازدید در ساعت</span>
        ${p.watch ? `<span class="badge watch">کلیدواژه تحت نظر</span>` : ""}
        <span>${esc(p.channel)} · ${fa(p.views)} بازدید · ${ago(p.at, res.data.now)}</span></div>
    </article>`).join("") : `<div class="empty">هنوز پستی دو بار خوانده نشده است؛ چند دقیقه بعد دوباره ببینید.</div>`);
    return;
  }
  const stories = newsPersonal(res.data.stories, prefs);
  list.innerHTML = staleNote(res.data) + `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minChannels)} کانال تلگرام گفته‌اند و هنوز هیچ سایتی نه.</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now)).join("") : `<div class="empty">در این بازه سوژه‌ای فقط در تلگرام نیست.</div>`);
}

// «چندرسانه‌ای» (with the module): the server keeps no media type, so an item's is read from its headline's marker,
// «فیلم/ …», «… + تصاویر», «(ویدئو)», or from its URL's section, /video/, /photo/, /media/. ponytail: the stories are
// «سوژه‌های داغ»'s, with each site's first headline only; a video a site posted after its text is missed, and a
// headline without a marker too.
const MEDIA_KINDS = { video: "ویدئو", photo: "عکس", graphic: "اینفوگرافیک", audio: "صوت", media: "چندرسانه‌ای" };
const MEDIA_WORDS = {
  video: "فیلم|ویدئو|ویدیو|ویدئوی|ویدیوی|کلیپ|موشن ?گرافیک",
  photo: "عکس|عکس ها|تصاویر|تصویر|گزارش تصویری|گالری",
  graphic: "اینفوگرافیک|اینفوگرافی",
  audio: "پادکست|صوت|فایل صوتی",
};
// the marker words begin or end the headline, set off by | / : - or +, or stand in parentheses
const MEDIA_MARKS = [
  ["photo", /گزارش تصویری/], ["graphic", /اینفوگرافی/], ["audio", /پادکست/], ["video", /موشن ?گرافیک/],
  ...Object.entries(MEDIA_WORDS).map(([kind, w]) =>
    [kind, new RegExp(`^(?:${w})\\s*[|/:،\\-–]|[+＋]\\s*(?:${w})(?![\\p{L}])|\\(\\s*(?:${w})\\s*\\)|[|/\\-–]\\s*(?:${w})\\s*$`, "u")]),
];
const MEDIA_PATHS = [
  ["video", /\/(videos?|films?|clips?)\//i], ["photo", /\/(photos?|gallery|galleries|pictures?)\//i],
  ["graphic", /\/infographics?\//i], ["audio", /\/(podcasts?|audios?)\//i], ["media", /\/(multimedia|media)\//i],
];

// "video", "photo", "graphic", "audio", "media" (a multimedia section, kind unknown) or null
function mediaKind(item) {
  const title = String(item.title ?? "").replace(/‌/g, " ").replace(/[يى]/g, "ی").replace(/ك/g, "ک").trim();
  for (const [kind, re] of MEDIA_MARKS) if (re.test(title)) return kind;
  let url = null;
  try { url = new URL(item.url); } catch (error) { return null; }
  if (/(^|\.)(aparat\.com|youtube\.com|youtu\.be)$/i.test(url.hostname)) return "video";
  for (const [kind, re] of MEDIA_PATHS) if (re.test(url.pathname)) return kind;
  return null;
}

// «کار شده»: stories with a media item on some site, most media first; «فرصت»: stories at least MEDIA_CHANCE_SITES
// sites told with no media item yet, the ones a multimedia desk can still be first on.
const MEDIA_CHANCE_SITES = 3;
let mediaMode = "made";

async function showMedia(id) {
  const prefs = await newsPrefs();
  modeBar({ made: "کار شده", chance: "فرصت" }, mediaMode, (v) => { mediaMode = v; show("media"); },
    `<label>بازه <select id="mhours">${[3, 6, 12, 24].map((h) => `<option value="${h}" ${h === prefs.mediaHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>`);
  document.getElementById("mhours").onchange = async (e) => { await saveNewsPrefs({ mediaHours: +e.target.value }); show("media"); };
  const mode = mediaMode;
  const res = await newsApi(`topics?hours=${prefs.mediaHours}&minSources=1`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  const now = res.data.now;
  const stories = newsPersonal(res.data.stories, prefs).map((s) => ({
    ...s, media: s.items.filter((i) => !i.telegram).map((i) => ({ ...i, kind: mediaKind(i) })).filter((i) => i.kind),
  }));
  if (mode === "chance") {
    const open = stories.filter((s) => s.sources >= MEDIA_CHANCE_SITES && !s.media.length);
    list.innerHTML = `<p class="muted">سوژه‌هایی که دست‌کم ${fa(MEDIA_CHANCE_SITES)} سایت کار کرده‌اند و در تیترهایشان هنوز ویدئو، عکس، اینفوگرافیک یا صوتی نیست.</p>` +
      (open.length ? open.map((s) => storyCard(s, now)).join("") : `<div class="empty">در این بازه سوژه پرمنبعی بی‌چندرسانه‌ای نیست.</div>`);
    return;
  }
  const made = stories.filter((s) => s.media.length).sort((a, b) => b.media.length - a.media.length || b.sources - a.sources);
  const badges = (media) => Object.entries(media.reduce((n, i) => ({ ...n, [i.kind]: (n[i.kind] ?? 0) + 1 }), {}))
    .map(([kind, c]) => `<span class="badge media">${MEDIA_KINDS[kind]} ${fa(c)}</span>`).join("");
  const rows = (media) => `<ul class="list">${media.map((i) => `<li><span class="badge media">${MEDIA_KINDS[i.kind]}</span>
    <a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("")}</ul>`;
  list.innerHTML = `<p class="muted">سوژه‌هایی که رسانه‌ها برایشان ویدئو، عکس، اینفوگرافیک یا صوت منتشر کرده‌اند (از روی تیتر و آدرس هر مطلب).</p>` +
    (made.length ? made.map((s) => storyCard(s, now, badges(s.media), rows(s.media))).join("") : `<div class="empty">در این بازه مطلب چندرسانه‌ای پیدا نشد.</div>`);
}

// «کپی برای پیام‌رسان»: a story as plain text for the team's Telegram or Bale group.
function storyText(s) {
  return [s.title, `${s.sources ? `${fa(s.sources)} منبع` : `${fa(s.channels)} کانال`} · اولین: ${s.firstSource}`, ...(s.items ?? []).slice(0, 8).map((i) => `- ${i.source}: ${i.url}`)].join("\n");
}

main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = "کپی شد";
  } catch (error) {
    b.textContent = "کپی نشد";
  }
  const label = b.dataset.trend ? "کپی بریف" : "کپی";
  setTimeout(() => { b.textContent = label; }, 2000);
});

// «زاویه‌ها» of a story: Google's suggestions for its trend, or for its headline cut shorter until Google knows it
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
    b.textContent = "زاویه‌ها";
    card.querySelector(".angles").innerHTML = `<div class="muted">زاویه‌ها از جستجوی گوگل خوانده می‌شوند؛ بدون اجازه دسترسی به آن نشان داده نمی‌شوند.</div>`;
    return;
  }
  const words = b.dataset.angles.split(/\s+/).filter(Boolean);
  let q = "", angles = [];
  for (q of new Set([words.length, 6, 4, 3].map((n) => words.slice(0, n).join(" ")))) {
    angles = await suggestions(q);
    if (angles.length) break;
  }
  card.querySelector(".angles").innerHTML = angles.length ? angleChips(angles, q) : `<div class="muted">گوگل برای این سوژه زاویه‌ای پیشنهاد نمی‌دهد.</div>`;
  b.hidden = true;
  // «کپی» now carries the angles too
  const copy = card.querySelector("button[data-copy]");
  if (angles.length) copy.dataset.copy += `\nزاویه‌ها:\n${angles.map((s) => `- ${s}`).join("\n")}`;
});

// «رد شد» on a gap story: gone from the list and the alerts, with a way back until the list is drawn again.
main.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-skip]");
  if (!b) return;
  const card = b.closest(".card");
  const key = b.dataset.skip;
  await newsSetSkipped(key, true);
  card.hidden = true;
  const undo = document.createElement("div");
  undo.className = "card muted";
  undo.innerHTML = `«${esc(card.querySelector("h3").textContent)}» کنار گذاشته شد. <a href="#">برگردان</a>`;
  undo.querySelector("a").onclick = async (ev) => {
    ev.preventDefault();
    await newsSetSkipped(key, false);
    undo.remove();
    card.hidden = false;
  };
  card.after(undo);
  // the button was hidden with its card: keyboard focus goes to the way back
  undo.querySelector("a").focus();
});

async function showSettings() {
  const prefs = await newsPrefs();
  const owner = state?.access?.role === "owner";
  main.innerHTML = `<section class="card">
      <h3>فیلترهای شخصی</h3>
      <p class="muted" style="margin:0">فقط برای خودتان. فیلترهای تیم (برای همه اعضا) در پنل جت‌سئو هستند${owner ? `: <a href="${safeUrl((state?.panelUrl ?? "") + "?tab=filters")}" target="_blank" rel="noopener">فیلترهای تیم</a>` : ""}.</p>
      <label for="excluded">کلمات مستثنی (با ویرگول جدا شوند؛ فقط کلمه کامل)</label>
      <textarea id="excluded">${esc(prefs.excluded.join("، "))}</textarea>
      <label for="watch">کلیدواژه‌های تحت نظر من (با ویرگول؛ فقط کلمه کامل). کنار کلیدواژه‌های تیم، برچسب و هشدار می‌گیرند.</label>
      <textarea id="watch">${esc(prefs.watch.join("، "))}</textarea>
      <label for="muted">منابع بی‌صدا (دامنه، با ویرگول)</label>
      <textarea id="muted" dir="ltr">${esc(prefs.muted.join(", "))}</textarea>
    </section>
    <section class="card">
      <h3>هشدارها</h3>
      <label class="row"><input type="checkbox" id="notifyGap" ${prefs.notifyGap ? "checked" : ""}/> سوژه‌ای که رقبا زده‌اند و ما نه</label>
      <label class="row"><input type="checkbox" id="notifyWatch" ${prefs.notifyWatch ? "checked" : ""}/> سوژه‌ای با کلیدواژه تحت نظر (تیم یا خودم)</label>
      <p class="muted" style="margin:0">هر ۵ دقیقه بررسی می‌شود، تا وقتی کروم باز است.</p>
    </section>
    <section class="card">
      <h3>میانبرها</h3>
      <p class="muted" style="margin:0">باز کردن جت‌سئو نیوز: <kbd id="shortcut">Alt+Shift+N</kbd> (<a href="#" id="shortcuts">تغییر</a>).
        روی صفحه یا لینکِ خبرهای سایت خودتان راست‌کلیک کنید: «بررسی سئوی این خبر».</p>
    </section>
    <button class="btn" id="save" type="button">ذخیره</button> <span id="saved" class="muted" hidden>ذخیره شد.</span>`;
  // the shortcut actually set: the user may have changed it, and Chrome leaves the suggested one unset on a conflict
  chrome.commands.getAll().then((commands) => {
    document.getElementById("shortcut").textContent = commands.find((c) => c.name === "_execute_action")?.shortcut || "تعریف نشده";
  }).catch(() => {});
  // chrome:// pages open only through the tabs API
  document.getElementById("shortcuts").onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); };
  const list = (id) => document.getElementById(id).value.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
  document.getElementById("save").onclick = async () => {
    await saveNewsPrefs({
      excluded: list("excluded"),
      watch: list("watch"),
      muted: list("muted").map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")),
      notifyGap: document.getElementById("notifyGap").checked,
      notifyWatch: document.getElementById("notifyWatch").checked,
    });
    document.getElementById("saved").hidden = false;
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
  const count = document.getElementById("gap-count");
  count.hidden = !text;
  count.textContent = text ? fa(text) : "";
});

start();
// not while the user types in a field: the redraw would take the focus
setInterval(() => {
  if (state?.access && ["dash", "topics", "gap"].includes(tab) && !document.activeElement?.matches("input, textarea, select")) show(tab);
}, 3 * 60 * 1000);
