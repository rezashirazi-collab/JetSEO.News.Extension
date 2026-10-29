// «جت‌سئو نیوز» background: the sign-in hand-off from jetseo.ir, and every 5 minutes the alerts (JetSEO design doc
// 6-2): coverage gaps of the user's sites and stories with a watched word, each told once.
// The icon's number is the gaps not looked at yet; the side panel clears it when its «شکاف پوشش» tab opens.

importScripts("api.js");

const POLL_MINUTES = 5;
const SEEN_MAX = 800;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create("news-poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("news-poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: 1 });
});

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
  const { newsNotified = {} } = await chrome.storage.session.get("newsNotified").catch(() => ({}));
  const url = newsNotified[id];
  if (url && /^https?:\/\//i.test(url)) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

// first: right after sign-in, when everything already there counts as seen (no flood of old stories).
async function poll(first) {
  const state = await newsApi("state");
  if (state.status !== 200 || !state.data?.access) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.storage.local.set({ newsState: state.data });
  const prefs = await newsPrefs();
  const { newsSeen = { gap: [], watch: [], started: false } } = await chrome.storage.local.get("newsSeen");
  const quiet = first || !newsSeen.started;
  const gapSeen = new Set(newsSeen.gap);
  const watchSeen = new Set(newsSeen.watch);
  const newGaps = [];
  let unseenGaps = 0;

  for (const site of state.data.sites ?? []) {
    if (!site.hasFeed || !site.competitors) continue;
    const gap = await newsApi(`gap?siteId=${site.id}&hours=${prefs.gapHours}`);
    if (gap.status !== 200) continue;
    for (const story of newsPersonal(gap.data.stories, prefs)) {
      const key = `${site.id}:${story.id}`;
      if (!gapSeen.has(key)) {
        unseenGaps++;
        if (!newsSeen.notified?.includes(key)) newGaps.push({ key, site: site.domain, story });
      }
    }
  }

  const newWatch = [];
  const topics = await newsApi(`topics?hours=3&minSources=1`);
  if (topics.status === 200) {
    for (const story of newsPersonal(topics.data.stories, prefs).filter((s) => s.watch)) {
      if (!watchSeen.has(String(story.id))) newWatch.push(story);
    }
  }

  const notified = new Set(newsSeen.notified ?? []);
  if (!quiet) {
    if (prefs.notifyGap && newGaps.length) {
      const top = newGaps[0];
      await notify(
        newGaps.length === 1 ? `رقبا زدند، شما نه (${top.site})` : `${newGaps.length} سوژه که رقبا زده‌اند و شما نه`,
        newGaps.slice(0, 3).map((g) => g.story.title).join("\n"),
        top.story.items?.[0]?.url
      );
    }
    if (prefs.notifyWatch && newWatch.length) {
      await notify(newWatch.length === 1 ? "کلیدواژه تحت نظر" : `${newWatch.length} سوژه با کلیدواژه تحت نظر`,
        newWatch.slice(0, 3).map((s) => s.title).join("\n"), newWatch[0].items?.[0]?.url);
    }
  }
  newGaps.forEach((g) => notified.add(g.key));
  // on the quiet first round the current gaps are the baseline: seen, not news
  const gapBaseline = quiet ? newGaps.map((g) => g.key) : [];
  await chrome.storage.local.set({
    newsSeen: {
      started: true,
      gap: [...gapSeen, ...gapBaseline].slice(-SEEN_MAX),
      watch: [...watchSeen, ...newWatch.map((s) => String(s.id))].slice(-SEEN_MAX),
      notified: [...notified].slice(-SEEN_MAX),
    },
  });
  const badge = quiet ? 0 : unseenGaps;
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

async function notify(title, message, url) {
  const id = `news-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { newsNotified = {} } = await chrome.storage.session.get("newsNotified").catch(() => ({}));
  const keep = Object.entries(newsNotified).slice(-30);
  await chrome.storage.session.set({ newsNotified: Object.fromEntries([...keep, [id, url ?? ""]]) }).catch(() => {});
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon-128.png", title, message: message.slice(0, 300), priority: 1 });
}
