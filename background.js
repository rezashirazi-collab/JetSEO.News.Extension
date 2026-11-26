// «جت‌سئو نیوز» background: the sign-in hand-off from jetseo.ir, and every 5 minutes the alerts (JetSEO design doc
// 6-2): coverage gaps of the user's sites and stories with a watched word, each told once.
// The icon's number is the gaps not looked at yet; the side panel clears it when its «شکاف پوشش» tab opens.
// Also the right-click «بررسی سئو» on the team's sites, and a notification's click, which open the app on their tab.

importScripts("api.js");

const POLL_MINUTES = 5;
const SEEN_MAX = 800;

// on every start of the worker, so a view chosen on another device (storage.sync) applies here too
newsView().then((view) => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: view === "panel" })).catch(() => {});
// with the full-page view the side panel does not take the click and it comes here
chrome.action.onClicked.addListener(() => newsOpenPage());

// On every start of the worker too, not only on install and startup: Chrome may drop an alarm (an update, a restart),
// and then nothing would wake the worker to make it again. An alarm that is there is left to its own timing.
async function ensureAlarm() {
  if (!(await chrome.alarms.get("news-poll"))) chrome.alarms.create("news-poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: 1 });
}
ensureAlarm();
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

// The sign-in page returns to /extension/connected: ask for the token right away and tell an open panel.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !/^https:\/\/(www\.)?jetseo\.ir\/extension\/connected/i.test(tab.url ?? "")) return;
  const account = await newsConnect();
  if (account) {
    chrome.runtime.sendMessage({ type: "news-account" }).catch(() => {});
    poll(true);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "news-poll") poll(false);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "news-gap-seen") markGapSeen(message.ids ?? []);
  if (message?.type === "news-poll") poll(false);
});

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const { newsNotified = {} } = await chrome.storage.session.get("newsNotified").catch(() => ({}));
  const go = newsNotified[id];
  // told before Chrome was closed (storage.session is gone) and left in the system's notification list: the app opens
  if (!go?.tab) return newsOpenPage();
  const [view, win] = await Promise.all([newsView(), chrome.windows.getLastFocused().catch(() => null)]);
  // after these awaits sidePanel.open may refuse (no user gesture left): then the full page opens
  openAt(go, view === "panel", win?.id);
});

// «من می‌نویسم» on a notification of one story (notify). api/News/mark overwrites, and the notification may be an hour
// old: the story is read again first, and marked only while it is still free. The notification then says what happened.
chrome.notifications.onButtonClicked.addListener(async (id) => {
  const { newsNotified = {} } = await chrome.storage.session.get("newsNotified").catch(() => ({}));
  const story = newsNotified[id]?.stories?.[0];
  if (!story) return newsOpenPage();
  const say = (title) => chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon-128.png", title, message: String(story.title ?? "").slice(0, 300) });
  const { newsState } = await chrome.storage.local.get("newsState");
  const lists = newsState && await newsAlertLists(newsState, await newsPrefs());
  if (!lists) return say("ثبت نشد؛ جت‌سئو پاسخ نداد");
  const now = [...lists.gaps, ...lists.watch, { stories: lists.foreign }].flatMap((l) => l.stories ?? []).find((s) => String(s.id) === String(story.id));
  if (!now) return say("این سوژه دیگر در فهرست نیست");
  if (now.mark) return say(now.mark.status === "taken" ? `این سوژه را ${now.mark.by || "یکی از اعضا"} برداشته است` : "این سوژه را تیم رد کرده است");
  const res = await newsApi(`mark?storyId=${encodeURIComponent(story.id)}&status=taken`, "POST");
  say(res.status === 200 ? "به تیم گفته شد: شما می‌نویسید" : "ثبت نشد؛ از داخل برنامه دوباره بزنید");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = String(info.menuItemId).startsWith("link") ? info.linkUrl : info.pageUrl;
  openAt({ tab: "mine", url }, String(info.menuItemId).endsWith("|panel"), tab?.windowId);
});

// The view's change rebuilds the menus, whose ids carry it.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync" || !changes.newsView) return;
  const { newsState } = await chrome.storage.local.get("newsState");
  menus(newsState?.access ? newsState.sites : []);
});

// Opens the app on go's tab ({ tab, siteId, url }, url = a page to check): the side panel when panel and windowId,
// else the full page. sidePanel.open needs the click's user gesture, so it is called before anything is awaited.
function openAt(go, panel, windowId) {
  chrome.storage.session.set({ newsGo: go }).then(() => chrome.runtime.sendMessage({ type: "news-go" })).catch(() => {});
  if (panel && windowId != null) chrome.sidePanel.open({ windowId }).catch(() => newsOpenPage());
  else newsOpenPage();
}

// «بررسی سئو» on the pages of the team's sites and on links to them (api/News/check takes only those). The ids carry
// the icon's view («page|panel»): a click must open the side panel at once, with no time to read the setting.
async function menus(sites) {
  await new Promise((done) => chrome.contextMenus.removeAll(done));
  const patterns = (sites ?? []).map((s) => String(s.domain).toLowerCase().replace(/^www\./, ""))
    .filter((d) => /^[a-z0-9.-]+$/.test(d)).map((d) => `*://*.${d}/*`);
  if (!patterns.length) return;
  const view = await newsView();
  // a second round running at the same time creates the same ids: its error is only noise
  const quiet = () => chrome.runtime.lastError;
  chrome.contextMenus.create({ id: `page|${view}`, title: "بررسی سئوی این خبر (جت‌سئو نیوز)", contexts: ["page"], documentUrlPatterns: patterns }, quiet);
  chrome.contextMenus.create({ id: `link|${view}`, title: "بررسی سئوی این لینک (جت‌سئو نیوز)", contexts: ["link"], targetUrlPatterns: patterns }, quiet);
}

// One round at a time: the alarm, the sign-in and the panel may all ask within the same seconds, and two rounds that
// read the same newsSeen would tell the same stories twice. A call during a round gets that round.
let polling = null;
function poll(first) {
  return (polling ??= pollOnce(first).catch(console.error).finally(() => { polling = null; }));
}

// first: right after sign-in, when everything already there counts as seen (no flood of old stories).
async function pollOnce(first) {
  const state = await newsApi("state");
  if (state.status !== 200 || !state.data?.access) {
    await chrome.action.setBadgeText({ text: "" });
    // signed out or no module; on a network error the menus stay
    if (state.status === 200 || state.status === 401) await menus([]);
    return;
  }
  await chrome.storage.local.set({ newsState: state.data });
  await menus(state.data.sites);
  const prefs = await newsPrefs();
  const skipped = await newsSkipped();
  const { newsSeen = { gap: [], watch: [], started: false } } = await chrome.storage.local.get("newsSeen");
  const quiet = first || !newsSeen.started;
  // «ساعت سکوت»: nothing is told, and what came then is not told afterwards either; the icon's number and the lists have it
  const mute = newsMuted(prefs, new Date().getHours());
  const lists = await newsAlertLists(state.data, prefs);
  // no answer this round: everything stays as it is
  if (!lists) return;
  const gapSeen = new Set(newsSeen.gap);
  const watchSeen = new Set(newsSeen.watch);
  const newGaps = [];
  const unseenGaps = [];
  // for «سوژه بی‌صاحب»: the gaps and the watched stories with no mark of the team (neither taken nor dismissed) that no
  // team's site has, by story id. Only from a server that sends the team's marks: without them every story would look free.
  const open = new Map();
  const free = (story) => { if ("mark" in story && !story.mark && !story.ours) open.set(String(story.id), story); };

  for (const { site, stories } of lists.gaps) {
    for (const story of newsPersonal(stories, prefs)) {
      const key = `${site.id}:${story.id}`;
      if (skipped.has(key)) continue;
      free(story);
      if (!gapSeen.has(key)) {
        unseenGaps.push(key);
        if (!newsSeen.notified?.includes(key)) newGaps.push({ key, site: site.domain, siteId: site.id, story });
      }
    }
  }

  // a watched word in a story the sites tell, or in one only Telegram channels tell so far
  const newWatch = [];
  for (const { tab, stories } of lists.watch) {
    for (const story of newsPersonal(stories, prefs).filter((s) => s.watch)) {
      free(story);
      if (!watchSeen.has(String(story.id)) && !newWatch.some((w) => w.id === story.id)) newWatch.push({ ...story, tab });
    }
  }

  // and in a story of the foreign media («رسانه‌های خارجی»): a Latin word, «openai», matches the English headlines as it is
  for (const story of newsGlobal(lists.foreign, prefs).filter((s) => s.watch)) {
    if (!watchSeen.has(String(story.id))) newWatch.push({ ...story, tab: "global" });
  }

  // «سوژه بی‌صاحب»: free for UNCLAIMED_MINUTES since this browser first saw it, told once. newsWaiting is
  // { id: [first seen, told] }, kept only for the stories still free, so it empties itself.
  const { newsWaiting = {} } = await chrome.storage.local.get("newsWaiting");
  const waiting = {}, overdue = [];
  if (prefs.notifyUnclaimed ?? state.data.access.role === "owner") {
    for (const [id, story] of open) {
      // on the quiet first round what is already there is the baseline, as with the gaps
      const [since, told] = newsWaiting[id] ?? [Date.now(), quiet];
      const due = !told && Date.now() - since >= UNCLAIMED_MINUTES * 60000;
      if (due) overdue.push(story);
      waiting[id] = [since, told || due];
    }
  }
  await chrome.storage.local.set({ newsWaiting: waiting });
  if (!quiet && !mute && overdue.length) {
    await notify(overdue.length === 1 ? "سوژه بی‌صاحب: هنوز کسی برنداشته" : `${overdue.length} سوژه بی‌صاحب: هنوز کسی برنداشته`,
      overdue.slice(0, 3).map((s) => s.title).join("\n"), { tab: "dash", stories: told(overdue) });
  }

  const notified = new Set(newsSeen.notified ?? []);
  if (!quiet && !mute) {
    if (prefs.notifyGap && newGaps.length) {
      const top = newGaps[0];
      await notify(
        newGaps.length === 1 ? `رقبا زدند، شما نه (${top.site})` : `${newGaps.length} سوژه که رقبا زده‌اند و شما نه`,
        newGaps.slice(0, 3).map((g) => g.story.title).join("\n"),
        { tab: "gap", siteId: top.siteId, stories: told(newGaps.map((g) => g.story)) }
      );
    }
    if (prefs.notifyWatch && newWatch.length) {
      await notify(newWatch.length === 1 ? "کلیدواژه تحت نظر" : `${newWatch.length} سوژه با کلیدواژه تحت نظر`,
        newWatch.slice(0, 3).map((s) => s.title).join("\n"), { tab: newWatch[0].tab, stories: told(newWatch) });
    }
  }
  newGaps.forEach((g) => notified.add(g.key));
  // on the quiet first round the current gaps are the baseline: seen, not news
  const gapBaseline = quiet ? newGaps.map((g) => g.key) : [];
  // The gaps seen are read again: while this round was reading the lists, the panel may have opened «شکاف پوشش»
  // (markGapSeen), and the list read at the start would undo that and bring the icon's number back.
  const { newsSeen: latest = newsSeen } = await chrome.storage.local.get("newsSeen");
  const gapNow = new Set([...(latest.gap ?? []), ...gapBaseline]);
  await chrome.storage.local.set({
    newsSeen: {
      started: true,
      gap: [...gapNow].slice(-SEEN_MAX),
      watch: [...watchSeen, ...newWatch.map((s) => String(s.id))].slice(-SEEN_MAX),
      notified: [...notified].slice(-SEEN_MAX),
    },
  });
  const badge = quiet ? 0 : unseenGaps.filter((key) => !gapNow.has(key)).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  await chrome.action.setBadgeText({ text: badge > 0 ? String(Math.min(badge, 99)) : "" });
}

async function markGapSeen(keys) {
  const { newsSeen = { gap: [], watch: [], started: true } } = await chrome.storage.local.get("newsSeen");
  const gap = new Set(newsSeen.gap);
  keys.forEach((k) => gap.add(k));
  await chrome.storage.local.set({ newsSeen: { ...newsSeen, gap: [...gap].slice(-SEEN_MAX) } });
  await chrome.action.setBadgeText({ text: "" });
}

// The stories a notification tells, as much of each as the panel's row of it needs (panel.js showTold, dashStory): the
// click opens the app with these very stories on top, whatever list is under them.
const told = (stories) => stories.slice(0, 30).map((s) => ({
  id: s.id, title: s.title, sources: s.sources, channels: s.channels, items: [{ url: s.items?.[0]?.url }],
  ...("mark" in s ? { mark: s.mark } : {}),
}));

// go: where its click opens the app ({ tab, siteId, stories }); the title goes with it, as the heading of its stories.
// A notification of one story nobody marked gets «من می‌نویسم» (onButtonClicked); of several, a button could not say which.
async function notify(title, message, go) {
  go = { ...go, title };
  const one = go.stories?.length === 1 && "mark" in go.stories[0] && !go.stories[0].mark;
  const id = `news-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { newsNotified = {} } = await chrome.storage.session.get("newsNotified").catch(() => ({}));
  const keep = Object.entries(newsNotified).slice(-30);
  await chrome.storage.session.set({ newsNotified: Object.fromEntries([...keep, [id, go]]) }).catch(() => {});
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon-128.png", title, message: message.slice(0, 300), priority: 1, ...(one ? { buttons: [{ title: "من می‌نویسم" }] } : {}) });
}
