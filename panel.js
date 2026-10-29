// «جت‌سئو نیوز» side panel (JetSEO design doc 3-5 and 4): signed out → the jetseo.ir sign-in;
// signed in without the module → Google Trends and the link to buy; with it → hot stories, the coverage gap of the
// user's sites, Google Trends and personal settings. Team settings (members, sites, competitors, team filters) are
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
  for (const b of tabsNav.querySelectorAll("button")) b.hidden = !a && b.dataset.tab !== "trends";
  if (!a) {
    tab = "trends";
    const ended = state.endedAt ? "اشتراک جت‌سئو نیوز شما تمام شده است." : "جت‌سئو نیوز برای حساب شما فعال نیست.";
    setBanner(`${ended} ترند گوگل رایگان است؛ سوژه‌های داغ رسانه‌ها و شکاف پوشش با اشتراک. <a href="${safeUrl(state.panelUrl)}" target="_blank" rel="noopener">${state.endedAt ? "تمدید" : "خرید یا ۷ روز رایگان"}</a>`, !!state.endedAt);
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
  ({ topics: showTopics, gap: showGap, trends: showTrends, settings: showSettings })[name](id);
}

tabsNav.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) show(b.dataset.tab);
});
document.getElementById("refresh").onclick = () => start();

function storyCard(s, now, extra = "") {
  const items = (s.items ?? []).map((i) =>
    `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">${esc(i.source)} · ${ago(i.at, now)}</span></li>`).join("");
  return `<article class="card">
    <h3>${esc(s.title)}</h3>
    <div class="meta">
      <span class="badge">${fa(s.sources)} منبع</span>
      ${s.watch ? `<span class="badge watch">کلیدواژه تحت نظر</span>` : ""}
      <span>اولین: ${esc(s.firstSource)} · ${ago(s.firstAt, now)}</span>
      ${extra}
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

// Google's daily searches in Iran (free for every signed-in user), read by the browser itself like the JetSEO extension.
async function showTrends(id) {
  main.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  let items = [];
  try {
    const response = await fetch("https://trends.google.com/trending/rss?geo=IR", { credentials: "omit", cache: "no-store" });
    const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
    items = [...xml.querySelectorAll("item")].map((item) => ({
      title: item.querySelector("title")?.textContent ?? "",
      traffic: item.getElementsByTagName("ht:approx_traffic")[0]?.textContent ?? "",
      news: [...item.getElementsByTagName("ht:news_item")].slice(0, 2).map((n) => ({
        title: n.getElementsByTagName("ht:news_item_title")[0]?.textContent ?? "",
        url: n.getElementsByTagName("ht:news_item_url")[0]?.textContent ?? "",
      })),
    }));
  } catch (error) {
    items = null;
  }
  if (id !== loadId) return;
  if (!items) { main.innerHTML = `<div class="empty">ترندهای گوگل بارگذاری نشد.</div>`; return; }
  main.innerHTML = `<p class="muted">جستجوهای داغ امروز گوگل در ایران.</p>` + (items.length ? items.map((t) => `<article class="card">
      <h3><a href="https://www.google.com/search?q=${encodeURIComponent(t.title)}" target="_blank" rel="noopener">${esc(t.title)}</a></h3>
      <div class="meta">${t.traffic ? `<span class="badge">${esc(t.traffic)} جستجو</span>` : ""}</div>
      ${t.news.length ? `<ul class="muted" style="margin:4px 0 0;padding-inline-start:16px">${t.news.map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join("")}</ul>` : ""}
    </article>`).join("") : `<div class="empty">ترندی نیست.</div>`);
}

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
