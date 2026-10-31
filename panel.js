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
let tab = "topics";
let gapSite = null;
let loadId = 0;

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
  for (const b of tabsNav.querySelectorAll("button")) b.hidden = !a && !["trends", "wiki", "days"].includes(b.dataset.tab);
  if (!a) {
    tab = "trends";
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
  show(tab);
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
  ({ topics: showTopics, gap: showGap, mine: showMine, trends: showTrends, wiki: showWiki, days: showDays, telegram: showTelegram, settings: showSettings })[name](id);
}

tabsNav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) show(b.dataset.tab);
});
document.getElementById("refresh").onclick = () => start();

// The same page is the popup (?view=popup), the side panel (no view) and the full page (?view=tab).
const VIEW = new URLSearchParams(location.search).get("view") ?? "panel";
document.body.dataset.view = VIEW;
document.querySelector(`#views [data-view="${VIEW}"]`).setAttribute("aria-pressed", "true");
let windowId = null;
chrome.windows.getCurrent().then((w) => (windowId = w.id));
document.getElementById("views").addEventListener("click", async (e) => {
  const view = e.target.closest("button[data-view]")?.dataset.view;
  if (!view || view === VIEW) return;
  // sidePanel.open must run inside the click, before any await
  if (view === "panel") chrome.sidePanel.open({ windowId }).catch(() => {});
  await chrome.runtime.sendMessage({ type: "news-view", view, windowId });
  window.close();
});

// s.trend: the Google trend or rising Wikipedia article in its headlines; s.channels: Telegram channels that told it
// (s.sources counts sites); s.telegramLead: minutes the first channel was ahead of the first site. All from the server.
function storyCard(s, now, extra = "") {
  const items = (s.items ?? []).map((i) =>
    `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${i.telegram ? "تلگرام · " : ""}${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("");
  return `<article class="card">
    <h3>${esc(s.title)}</h3>
    <div class="meta">
      ${s.sources ? `<span class="badge">${fa(s.sources)} منبع</span>` : ""}
      ${s.channels ? `<span class="badge">${fa(s.channels)} کانال</span>` : ""}
      ${s.telegramLead > 0 ? `<span class="badge tg">اول در تلگرام · ${duration(s.telegramLead)} زودتر</span>` : ""}
      ${s.watch ? `<span class="badge watch">کلیدواژه تحت نظر</span>` : ""}
      ${s.trend ? `<span class="badge trend">ترند ${esc(s.trend.source)}: ${esc(s.trend.text)}</span>` : ""}
      <span>اولین: ${esc(s.firstSource)} · ${ago(s.firstAt, now)}</span>
      ${extra}
      <button class="btn ghost small" type="button" data-copy="${esc(storyText(s))}" title="کپی برای پیام‌رسان">کپی</button>
    </div>
    <details><summary>تیترها (${fa(s.items?.length ?? 0)})</summary><ul>${items}</ul></details>
  </article>`;
}

async function showTopics(id) {
  const prefs = await newsPrefs();
  main.innerHTML = `<div class="controls">
      <label>بازه <select id="hours">${[1, 3, 6, 12].map((h) => `<option value="${h}" ${h === prefs.topicHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>
      <label>حداقل منبع <select id="min">${[2, 3, 5, 8].map((m) => `<option value="${m}" ${m === prefs.minSources ? "selected" : ""}>${fa(m)}</option>`).join("")}</select></label>
    </div><div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  document.getElementById("hours").onchange = async (e) => { await saveNewsPrefs({ topicHours: +e.target.value }); show("topics"); };
  document.getElementById("min").onchange = async (e) => { await saveNewsPrefs({ minSources: +e.target.value }); show("topics"); };
  const res = await newsApi(`topics?hours=${prefs.topicHours}&minSources=${prefs.minSources}`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  const stories = newsPersonal(res.data.stories, prefs);
  list.innerHTML = stories.length ? stories.map((s) => storyCard(s, res.data.now)).join("") : `<div class="empty">در این بازه سوژه‌ای با این تعداد منبع نیست.</div>`;
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
  const stories = newsPersonal(res.data.stories, prefs);
  list.innerHTML = `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minCompetitors)} رقیب از ${fa(res.data.competitors)} رقیب شما کار کرده‌اند و ${esc(res.data.site)} نه.</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now, `<span>رقبا: ${esc((s.competitors ?? []).join("، "))}</span>`)).join("") : `<div class="empty">شکافی نیست؛ هرچه رقبا زده‌اند، شما هم زده‌اید.</div>`);
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
  list.innerHTML = `<p class="muted">خبرهای ۲۴ ساعت اخیر ${esc(res.data.site)}. ${summary}</p>` + (items.length ? items.map((i, n) => `<article class="card">
      <h3><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <div class="meta">${lagBadge(i)} <span>${ago(i.at, res.data.now)}</span>
        <button class="btn ghost" type="button" data-check="${n}" style="padding:0 10px">بررسی سئو</button></div>
      <div data-out="${n}"></div>
    </article>`).join("") : `<div class="empty">در ۲۴ ساعت اخیر خبری از این سایت خوانده نشده است.</div>`);
  list.onclick = (e) => {
    const b = e.target.closest("button[data-check]");
    if (b) runCheck(items[+b.dataset.check].url, list.querySelector(`[data-out="${b.dataset.check}"]`));
  };
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
async function freeApi(id, path, what) {
  main.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  const res = await newsApi(path);
  if (id !== loadId) return null;
  if (res.status === 401) { signedOut(); return null; }
  if (res.status !== 200) { main.innerHTML = `<div class="empty">${what} بارگذاری نشد. کمی بعد ⟳ را بزنید.</div>`; return null; }
  return res.data;
}

async function showTrends(id) {
  const data = await freeApi(id, "google", "ترندهای گوگل");
  if (!data) return;
  const items = data.trends ?? [];
  main.innerHTML = `<p class="muted">جستجوهای داغ امروز گوگل در ایران.</p>` + (items.length ? items.map((t) => `<article class="card">
      <h3><a href="https://www.google.com/search?q=${encodeURIComponent(t.title)}" target="_blank" rel="noopener">${esc(t.title)}</a></h3>
      <div class="meta">${t.traffic ? `<span class="badge">${esc(t.traffic)} جستجو</span>` : ""}</div>
      ${t.news?.length ? `<ul class="muted" style="margin:4px 0 0;padding-inline-start:16px">${t.news.map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join("")}</ul>` : ""}
    </article>`).join("") : `<div class="empty">ترندی نیست.</div>`);
}

// «رو به رشد»: read at least twice as much as the day before and the week before; «ویرایش داغ»: articles several people
// edited in the last 3 hours, where a death or an event shows before it shows in the reads.
let wikiMode = "rising";
const wikiLink = (title) => `https://fa.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
const newsLink = (q) => `<a href="https://news.google.com/search?q=${encodeURIComponent(q)}&hl=fa&gl=IR&ceid=IR:fa" target="_blank" rel="noopener">چرا؟ خبرها</a>`;

async function showWiki(id) {
  const modes = { rising: "رو به رشد", top: "پربازدیدترین", edits: "ویرایش داغ" };
  const controls = `<div class="controls">
      <select id="wmode" aria-label="نوع فهرست">${Object.entries(modes).map(([v, t]) => `<option value="${v}" ${v === wikiMode ? "selected" : ""}>${t}</option>`).join("")}</select>
    </div>`;
  const mode = wikiMode;
  const data = await freeApi(id, `wiki?mode=${mode}`, "آمار ویکی‌پدیا");
  if (!data) return;
  if (mode === "edits") {
    const edits = data.edits ?? [];
    main.innerHTML = controls + `<p class="muted">مقاله‌هایی از ویکی‌پدیای فارسی که در ۳ ساعت اخیر چند نفر ویرایششان کرده‌اند (بدون ربات‌ها).</p>` +
      (edits.length ? edits.map((p) => `<article class="card">
      <h3><a href="${wikiLink(p.title)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge ${p.editors >= 4 ? "late" : "watch"}">${fa(p.editors)} ویرایشگر</span><span>${fa(p.edits)} ویرایش</span>
        <a href="${wikiLink(p.title)}?action=history" target="_blank" rel="noopener">تاریخچه</a> ${newsLink(p.title)}</div>
    </article>`).join("") : `<div class="empty">در ۳ ساعت اخیر مقاله‌ای ویرایش همزمان نداشته است.</div>`);
  } else {
    const items = data.items ?? [];
    const date = new Date(data.day).toLocaleDateString("fa-IR", { timeZone: "UTC" });
    main.innerHTML = controls + `<p class="muted">${mode === "top" ? "پربازدیدترین" : "مقاله‌هایی از ویکی‌پدیای فارسی که بازدیدشان دست‌کم دو برابر دیروز و هفته پیش شده،"} در ${esc(date)}.</p>` +
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
  document.getElementById("wmode").onchange = (e) => { wikiMode = e.target.value; show("wiki"); };
}

// «مناسبت‌ها»: events, births and deaths of the solar day with how many years ago, round anniversaries (every 5 years)
// first, and the occasions of the Gregorian day; from Wikipedia's day pages.
let dayOffset = 1;

async function showDays(id) {
  const names = ["امروز", "فردا", "پس‌فردا"];
  const data = await freeApi(id, `days?offset=${dayOffset}`, "مناسبت‌های این روز");
  if (!data) return;
  const label = { "رویدادها": "رویداد", "زادروزها": "زادروز", "درگذشت‌ها": "درگذشت" };
  const row = (e) => `<li>${esc(e.what)} <span class="muted">· ${label[e.section] ?? ""} · ${e.ago % 5 ? `${fa(e.ago)} سال پیش` : `<b>${fa(e.ago)}امین سالگرد</b>`}</span></li>`;
  const entries = data.entries ?? [];
  const card = (title, body) => body ? `<section class="card"><h3>${title}</h3><ul style="margin:0;padding-inline-start:16px">${body}</ul></section>` : "";
  main.innerHTML = `<div class="controls">
      <select id="dday" aria-label="روز">${names.map((t, n) => `<option value="${n}" ${n === dayOffset ? "selected" : ""}>${t}</option>`).join("")}</select>
    </div>
    <p class="muted">${esc(data.solar)} (${esc(data.gregorian)}) از ویکی‌پدیای فارسی:
      <a href="${wikiLink(data.solar)}" target="_blank" rel="noopener">${esc(data.solar)}</a> و <a href="${wikiLink(data.gregorian)}" target="_blank" rel="noopener">${esc(data.gregorian)}</a></p>` +
    card("سالگردهای رُند", entries.filter((e) => e.ago % 5 === 0).map(row).join("")) +
    card("مناسبت‌های جهانی", (data.occasions ?? []).map((o) => `<li>${esc(o)}</li>`).join("")) +
    ["رویدادها", "زادروزها", "درگذشت‌ها"].map((s) => card(s, entries.filter((e) => e.section === s && e.ago % 5).map(row).join(""))).join("");
  document.getElementById("dday").onchange = (e) => { dayOffset = +e.target.value; show("days"); };
}

// «تلگرام» (with the module): mode "only", stories only Telegram channels have told so far; mode "trend", the posts
// spreading fastest for their channel (api/News/telegram). The channels are read on the server, through ai.jetseo.ir.
let telegramMode = "only";

async function showTelegram(id) {
  const prefs = await newsPrefs();
  const modes = { only: "فقط در تلگرام", trend: "ترند تلگرام" };
  main.innerHTML = `<div class="controls">
      <select id="tmode" aria-label="نوع فهرست">${Object.entries(modes).map(([v, t]) => `<option value="${v}" ${v === telegramMode ? "selected" : ""}>${t}</option>`).join("")}</select>
      <label>بازه <select id="thours">${[3, 6, 12].map((h) => `<option value="${h}" ${h === prefs.telegramHours ? "selected" : ""}>${fa(h)} ساعت</option>`).join("")}</select></label>
    </div><div id="list"><div class="empty">در حال بارگذاری…</div></div>`;
  document.getElementById("tmode").onchange = (e) => { telegramMode = e.target.value; show("telegram"); };
  document.getElementById("thours").onchange = async (e) => { await saveNewsPrefs({ telegramHours: +e.target.value }); show("telegram"); };
  const mode = telegramMode;
  const res = await newsApi(`telegram?mode=${mode}&hours=${prefs.telegramHours}`);
  if (id !== loadId) return;
  const list = document.getElementById("list");
  if (res.status === 403) return start();
  if (res.status !== 200) { list.innerHTML = `<div class="empty">بارگذاری نشد. ⟳ را بزنید.</div>`; return; }
  if (mode === "trend") {
    const posts = (res.data.posts ?? []).filter((p) => !prefs.muted.includes(String(p.domain ?? "").toLowerCase()));
    list.innerHTML = `<p class="muted">پست‌هایی که بازدیدشان از معمولِ همان کانال تندتر بالا می‌رود.</p>` + (posts.length ? posts.map((p) => `<article class="card">
      <h3><a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="meta"><span class="badge late">${fa(p.relative)} برابر معمول کانال</span><span class="badge">${fa(p.perHour)} بازدید در ساعت</span>
        ${p.watch ? `<span class="badge watch">کلیدواژه تحت نظر</span>` : ""}
        <span>${esc(p.channel)} · ${fa(p.views)} بازدید · ${ago(p.at, res.data.now)}</span></div>
    </article>`).join("") : `<div class="empty">هنوز پستی دو بار خوانده نشده است؛ چند دقیقه بعد دوباره ببینید.</div>`);
    return;
  }
  const stories = newsPersonal(res.data.stories, prefs);
  list.innerHTML = `<p class="muted">سوژه‌هایی که دست‌کم ${fa(res.data.minChannels)} کانال تلگرام گفته‌اند و هنوز هیچ سایتی نه.</p>` +
    (stories.length ? stories.map((s) => storyCard(s, res.data.now)).join("") : `<div class="empty">در این بازه سوژه‌ای فقط در تلگرام نیست.</div>`);
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
  setTimeout(() => { b.textContent = "کپی"; }, 2000);
});

async function showSettings() {
  const prefs = await newsPrefs();
  const owner = state?.access?.role === "owner";
  main.innerHTML = `<section class="card">
      <h3>فیلترهای شخصی</h3>
      <p class="muted" style="margin:0">فقط برای خودتان. فیلترهای تیم (برای همه اعضا) در پنل جت‌سئو هستند${owner ? `: <a href="${safeUrl((state?.panelUrl ?? "") + "?tab=filters")}" target="_blank" rel="noopener">فیلترهای تیم</a>` : ""}.</p>
      <label for="excluded">کلمات مستثنی (با ویرگول جدا شوند؛ فقط کلمه کامل)</label>
      <textarea id="excluded">${esc(prefs.excluded.join("، "))}</textarea>
      <label for="muted">منابع بی‌صدا (دامنه، با ویرگول)</label>
      <textarea id="muted" dir="ltr">${esc(prefs.muted.join(", "))}</textarea>
    </section>
    <section class="card">
      <h3>هشدارها</h3>
      <label class="row"><input type="checkbox" id="notifyGap" ${prefs.notifyGap ? "checked" : ""}/> سوژه‌ای که رقبا زده‌اند و ما نه</label>
      <label class="row"><input type="checkbox" id="notifyWatch" ${prefs.notifyWatch ? "checked" : ""}/> سوژه‌ای با کلیدواژه تحت نظر تیم</label>
      <p class="muted" style="margin:0">هر ۵ دقیقه بررسی می‌شود، تا وقتی کروم باز است.</p>
    </section>
    <button class="btn" id="save" type="button">ذخیره</button> <span id="saved" class="muted" hidden>ذخیره شد.</span>`;
  const list = (id) => document.getElementById(id).value.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
  document.getElementById("save").onclick = async () => {
    await saveNewsPrefs({
      excluded: list("excluded"),
      muted: list("muted").map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")),
      notifyGap: document.getElementById("notifyGap").checked,
      notifyWatch: document.getElementById("notifyWatch").checked,
    });
    document.getElementById("saved").hidden = false;
  };
}

// the background tells the panel when the sign-in hand-off finished
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "news-account") start();
});

// the gap count from the background's last round, until the tab is opened
chrome.action.getBadgeText({}).then((text) => {
  const count = document.getElementById("gap-count");
  count.hidden = !text;
  count.textContent = text ? fa(text) : "";
});

start();
setInterval(() => { if (state?.access && (tab === "topics" || tab === "gap")) show(tab); }, 3 * 60 * 1000);
