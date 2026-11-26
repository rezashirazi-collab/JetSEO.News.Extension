// node tools/check.js: the checks of api.js that need no browser. Exits 1 on the first failure.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// api.js is a plain script of top-level declarations, no module (the background loads it with importScripts): its
// functions become the context's own
const api = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8"), api);
// lib.js: the panel's rules that need no page, on top of api.js as in panel.html
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "lib.js"), "utf8"), api);

// «ساعت سکوت»: from up to to, over midnight when from is the later hour; unset or both the same = none
const muted = (quietFrom, quietTo) => [0, 6, 7, 12, 21, 22, 23].filter((h) => api.newsMuted({ quietFrom, quietTo }, h)).join();
assert.strictEqual(muted(22, 7), "0,6,22,23");
assert.strictEqual(muted(7, 22), "7,12,21");
assert.strictEqual(muted(null, 7) + muted(9, 9), "");

// «مقایسه تیتر»: the words at least half the other headlines (and two) use and ours does not; folded, no stop words
assert.strictEqual(JSON.stringify(api.headlineGap("دلار گران شد", ["قیمت دلار در بازار", "قيمت دلار امروز", "بازار ارز و قیمت سکه"])), '[["قیمت",3],["بازار",2]]');

// «چندرسانه‌ای»: the kind from the headline's marker, else from the URL's section; a word inside a headline is no marker
const kind = (title, url = "https://a.ir/news/1") => api.mediaKind({ title, url });
assert.deepStrictEqual([kind("فیلم/ لحظه گل"), kind("بازدید وزیر + تصاویر"), kind("تولید فیلم تازه آغاز شد"), kind("خبر", "https://a.ir/video/1"), kind("خبر", "نشانی")],
  ["video", "photo", null, "video", null]);

// «کلمات پرجستجو»: a question word wins, then the server's informational or an informational word
assert.deepStrictEqual([api.keywordType("يارانه چيست", false), api.keywordType("علت قطعی برق", false), api.keywordType("خرید دلار", true), api.keywordType("خرید دلار", false)],
  ["question", "info", "info", "other"]);

// Google's rounded searches as a number, for the bars
assert.deepStrictEqual(["20K+", "۲ هزار+", "1.5M", ""].map(api.trafficNumber), [20000, 2000, 1500000, 0]);

// «خروجی»: the BOM, quoting, and no cell that Excel would run as a formula
const csv = api.newsCsv(["تیتر", "تأخیر"], [
  ['=HYPERLINK("http://evil.example","خبر")', -12],
  ["+98 خبر، با «ویرگول», و\nخط دوم", 3],
  ["@channel گفت", null],
  ["تیتر ساده", 0],
]);
assert.strictEqual(csv, "﻿تیتر,تأخیر\r\n" +
  "\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"خبر\"\")\",-12\r\n" +
  "\"'+98 خبر، با «ویرگول», و\nخط دوم\",3\r\n" +
  "'@channel گفت,\r\n" +
  "تیتر ساده,0");

// the folding the filters and «کلمات پرجستجو» share
assert.strictEqual(api.newsFold("آيا «دلارِ» ۱۴۰۵ گران مي‌شود؟"), "آیا دلار 1405 گران می شود");
assert.ok(api.newsMatches(api.newsFold("قیمت دلار امروز"), "دلار"));
assert.ok(!api.newsMatches(api.newsFold("ایرانسل"), "ایران"));

// «در سایت شما»: a foreign story's ours is a list of headlines, and an empty one is not «on our site»
assert.deepStrictEqual([{ ours: [] }, { ours: [{}] }, { ours: true }, { ours: false }, {}].map(api.newsOnOurSite), [false, true, true, false, false]);

// «فقط کلیدواژه‌های من»: only the stories with a watched word (the user's own, or the server's watch for the team's);
// off, or with no word of the user's own, every story stays
const stories = [
  { id: 1, title: "قیمت دلار امروز", items: [{ title: "قیمت دلار امروز", domain: "a.ir" }] },
  { id: 2, title: "نتیجه بازی", items: [{ title: "نتیجه بازی", domain: "a.ir" }] },
  { id: 3, title: "خبر تیم", watch: true, items: [{ title: "خبر تیم", domain: "a.ir" }] },
];
const prefs = (more) => ({ excluded: [], muted: [], topics: [], watch: ["دلار"], watchOnly: true, ...more });
const ids = (list) => JSON.stringify(list.map((s) => s.id));
assert.strictEqual(ids(api.newsPersonal(stories, prefs())), "[1,3]");
assert.strictEqual(ids(api.newsGlobal(stories, prefs())), "[1,3]");
assert.strictEqual(ids(api.newsPersonal(stories, prefs({ watchOnly: false }))), "[1,2,3]");
assert.strictEqual(ids(api.newsPersonal(stories, prefs({ watch: [] }))), "[1,2,3]");

// a watched word marks a story in its main headline or in two sources' headlines, not in one other source's alone,
// and the word comes along for the badge
const told2 = (title, ...others) => ({ title, items: [title, ...others].map((t, i) => ({ title: t, domain: `${i}.ir` })) });
const watchWord = (s) => api.newsPersonal([s], prefs({ watch: ["تولید", "کالابرگ"], watchOnly: false }))[0].watchWord ?? null;
assert.strictEqual(watchWord(told2("کالابرگ گروه سوم شارژ شد")), "کالابرگ");
assert.strictEqual(watchWord(told2("قدرت تخریب موشک‌ها را بالا می‌بریم", "تولید موشک افزایش یافت")), null);
assert.strictEqual(watchWord(told2("رکورد گندم", "تولید گندم بالا رفت", "رکورد تولید")), "تولید");
assert.strictEqual(api.newsPersonal([{ ...told2("خبر"), watch: true, watchWord: "تیم" }], prefs())[0].watchWord, "تیم");

// «مقایسه با رسانه‌های دیگر»: a site once per story, first = the earliest site (not the channel ahead of it), the team's
// sites one row whose covered is the server's ours, and no «first» for a team whose headlines are in no story
const told = (domain, more) => ({ source: domain, domain, ...more });
const hotStories = [
  { sources: 3, ours: true, items: [told("t.me/x", { telegram: true }), told("a.ir"), told("www.Ours.ir"), told("a.ir"), told("b.ir")] },
  { sources: 2, items: [told("b.ir"), told("a.ir")] },
  { sources: 13, ours: true, items: [told("a.ir")] },
];
const rank = api.newsMediaRank(hotStories, ["ours.ir"]);
assert.strictEqual(JSON.stringify(rank.rows.map((r) => [r.ours ? "ours" : r.name, r.covered, r.first])), '[["a.ir",3,2],["b.ir",2,1],["ours",2,0]]');
assert.strictEqual(rank.cut, 1);
// each row carries the stories it told (the dashboard's row opens those the team has not)
assert.ok(rank.rows.every((r) => r.ours || r.stories.length === r.covered));
assert.strictEqual(api.newsMediaRank(hotStories, ["other.ir"]).rows.find((r) => r.ours).first, null);

// The story prompts (lib.js). Each kind names its story and its links, says what only it says, and keeps one place for
// «مردم چه می‌پرسند؟».
const panel = fs.readFileSync(path.join(__dirname, "..", "panel.js"), "utf8");
const { storyPrompt, NO_ANGLES, PROMPT_OUTPUT, PROMPT_KINDS, PROMPT_FORMATS, promptAs } =
  vm.runInContext("({ storyPrompt, NO_ANGLES, PROMPT_OUTPUT, PROMPT_KINDS, PROMPT_FORMATS, promptAs })", api);
const story = { title: "قیمت دلار", sources: 4, firstSource: "ایسنا", items: [{ source: "ایسنا", title: "دلار گران شد", url: "https://a.example/1" }],
  competitors: ["رقیب یک", "رقیب دو"], covers: [{ source: "زومیت", title: "تیتر فارسی", url: "https://z.example/2" }] };
const only = { new: "مطلب تازه و مستقل", update: "[نشانی یا متن مطلب خودتان را این‌جا بگذارید]", gap: "رقیب یک، رقیب دو", foreign: "https://z.example/2" };
for (const kind of Object.keys(PROMPT_KINDS)) {
  const text = storyPrompt(story, kind);
  assert.strictEqual(text.split(NO_ANGLES).length, 2, kind);
  for (const part of ["سوژه: قیمت دلار", "https://a.example/1", only[kind]]) assert.ok(text.includes(part), `${kind}: ${part}`);
  assert.ok(!/undefined|\[object/.test(text), kind);
  // another output: the story and the angles' place stay, the article's own output goes
  for (const [format, f] of Object.entries(PROMPT_FORMATS)) {
    const other = promptAs(text, format);
    const [before, output, ...rest] = other.split(PROMPT_OUTPUT);
    assert.strictEqual(rest.length, 0, `${kind}/${format}`);
    assert.strictEqual(before, text.split(PROMPT_OUTPUT)[0], `${kind}/${format}`);
    assert.ok(output.includes(f.output[0]) && !output.includes(PROMPT_KINDS[kind].output[0]), `${kind}/${format}`);
  }
}
// a story with neither count (the card shows no count badge then) says nothing of one
assert.ok(storyPrompt({ title: "t", firstSource: "ایسنا", items: [] }, "new").includes("سوژه: t\nاولین: ایسنا\n\n"));
// a foreign story has no firstSource and may have no Persian headline
assert.ok(storyPrompt({ title: "Nvidia", sources: 2, items: [{ source: "Reuters", title: "t", url: "https://r.example" }] }, "foreign").includes("اولین: Reuters"));

// patch (panel.js, the dashboard's cards): a card that did not change stays the same element, one that changed is put
// in anew, and what another tab drew goes. The DOM here is just big enough for it: a box of <section> elements.
{
  class El {
    constructor(html) { this.outerHTML = html; this.parent = null; }
    get isConnected() { return !!this.parent; }
    remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
    before(el) { el.remove(); const p = this.parent; p.children.splice(p.children.indexOf(this), 0, el); el.parent = p; }
  }
  class Box {
    constructor() { this.children = []; }
    append(el) { el.remove(); this.children.push(el); el.parent = this; }
    set textContent(v) { this.children.forEach((c) => (c.parent = null)); this.children = []; }
    get html() { return this.children.map((c) => c.outerHTML).join(""); }
  }
  const document = { createElement: () => ({ set innerHTML(h) { const b = new Box(); (h.match(/<section>.*?<\/section>/g) || []).forEach((x) => b.append(new El(x))); this.content = b; } }) };
  const text = panel.replace(/\r\n/g, "\n"), from = text.indexOf("function patch(box, html)");
  const patch = new Function("document", text.slice(from, text.indexOf("\n}\n", from) + 3) + ";return patch")(document);
  const box = new Box(), [A, B, C, B2] = ["a", "b", "c", "b2"].map((x) => `<section>${x}</section>`);
  box.append(new El("<section>another tab</section>"));
  patch(box, A + B + C);
  assert.strictEqual(box.html, A + B + C);
  const [a, b, c] = box.children;
  patch(box, A + B2 + C);
  assert.ok(box.html === A + B2 + C && box.children[0] === a && box.children[1] !== b && box.children[2] === c);
  patch(box, A + C);
  assert.ok(box.html === A + C && box.children[1] === c);
  patch(box, B + A + C + B2);
  assert.ok(box.html === B + A + C + B2 && box.children[1] === a && box.children[2] === c);
  patch(box, "");
  assert.strictEqual(box.html, "");
}

// The clicked notification's stories (panel.js showTold … refreshTold): no «من می‌نویسم» from the mark the background
// saw, only from the story as the server has it now. The lists are api.js newsAlertLists: one request to a server with
// api/News/alerts, list by list to one without it (404), and nothing from a server that does not answer.
(async () => {
  const text = panel.replace(/\r\n/g, "\n");
  const asked = [];
  const lists = { "topics?hours=3&minSources=1": [{ id: 1, title: "a", mark: { status: "taken", by: "همکار" } }], "gap?siteId=7&hours=6": [{ id: 2, title: "b", mark: null }], "foreign?hours=6": [{ id: 3, title: "c", mark: null }] };
  let alerts = { status: 404 }, down = false;
  api.newsApi = async (p) => (asked.push(p), p.startsWith("alerts") ? alerts : lists[p] && !down ? { status: 200, data: { now: "n", stories: lists[p] } } : { status: 500 });
  const sites = [{ id: 7, domain: "a.ir", hasFeed: true, competitors: 2 }, { id: 8 }];
  const old = await api.newsAlertLists({ sites, foreignNews: true }, { hours: 6 });
  assert.strictEqual(JSON.stringify([old.now, old.gaps.map((g) => [g.site.id, g.stories.length]), old.watch.map((w) => w.tab), old.foreign.length]), '["n",[[7,1]],["topics"],1]');
  assert.ok(!asked.some((p) => p.includes("siteId=8")));
  alerts = { status: 200, data: { now: "n", gaps: [{ siteId: 7, domain: "a.ir", stories: [] }], topics: lists["topics?hours=3&minSources=1"], telegram: [], foreign: null } };
  asked.length = 0;
  const one = await api.newsAlertLists({ sites }, { hours: 6 });
  assert.deepStrictEqual(asked, ["alerts?hours=6"]);
  assert.strictEqual(JSON.stringify([one.gaps[0].site, one.watch.map((w) => [w.tab, w.stories.length]), one.foreign]), '[{"id":7,"domain":"a.ir"},[["topics",1],["telegram",0]],null]');
  alerts = { status: 0 };
  assert.strictEqual(await api.newsAlertLists({ sites }, { hours: 6 }), null);
  // an alerts that fails on the server does not silence the lists that answer; with none answering, nothing
  alerts = { status: 500 };
  assert.strictEqual((await api.newsAlertLists({ sites }, { hours: 6 })).gaps.length, 1);
  down = true;
  assert.strictEqual(await api.newsAlertLists({ sites }, { hours: 6 }), null);
  down = false;
  alerts = { status: 404 };
  asked.length = 0;

  // background.js, on a chrome that does nothing but keep the storage and the notifications told. One story is in the
  // gap of site 7. Two rounds asked at once are one round and one notification, with «من می‌نویسم» on it; a gap the
  // panel marks seen while a round reads is still seen after it; and in «ساعت سکوت» a new story is told neither then
  // nor later.
  {
    const areas = { local: { newsSeen: { started: true, gap: [], watch: [], notified: [] } }, sync: {}, session: {} };
    const area = (data) => ({
      get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
      set: async (values) => { Object.assign(data, structuredClone(values)); },
      remove: async (keys) => { [keys].flat().forEach((k) => delete data[k]); },
    });
    const notes = [], badge = [];
    // any other chrome.x.y(...): calls a callback it is given (not a listener) and answers nothing
    const idle = (called) => new Proxy(function () {}, {
      get: (_, name) => (name === "then" ? undefined : idle(name)),
      apply: (_, __, args) => { if (called !== "addListener") args.findLast((a) => typeof a === "function")?.(); return Promise.resolve(undefined); },
    });
    const chrome = new Proxy({
      storage: { local: area(areas.local), sync: area(areas.sync), session: area(areas.session), onChanged: idle() },
      notifications: { create: (id, options) => notes.push(options), clear() {}, onClicked: idle(), onButtonClicked: idle() },
      action: { setBadgeText: async ({ text }) => { badge.push(text); }, setBadgeBackgroundColor: async () => {}, onClicked: idle() },
    }, { get: (target, name) => target[name] ?? idle() });
    const bg = vm.createContext({ chrome, console, importScripts() {}, structuredClone });
    for (const file of ["api.js", "background.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), bg);
    let gapStories = [{ id: 1, title: "x", mark: null, items: [{ title: "x", domain: "b.ir" }] }], hold = Promise.resolve();
    bg.newsApi = async (p) => {
      if (p === "state") return { status: 200, data: { access: { role: "member" }, sites } };
      await hold;
      return { status: 200, data: { now: "n", gaps: [{ siteId: 7, domain: "a.ir", stories: gapStories }], topics: [], telegram: [], foreign: null } };
    };
    await Promise.all([bg.poll(false), bg.poll(false)]);
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0].buttons?.[0].title, "من می‌نویسم");
    assert.strictEqual(badge.at(-1), "1");
    let release;
    hold = new Promise((done) => { release = done; });
    const round = bg.poll(false);
    await new Promise((done) => setTimeout(done, 5));
    await bg.markGapSeen(["7:1"]);
    release();
    await round;
    assert.ok(areas.local.newsSeen.gap.includes("7:1") && badge.at(-1) === "");
    const hour = new Date().getHours();
    areas.sync.newsPrefs = { quietFrom: hour, quietTo: (hour + 1) % 24 };
    gapStories = [...gapStories, { id: 2, title: "y", mark: null, items: [{ title: "y", domain: "b.ir" }] }];
    await bg.poll(false);
    areas.sync.newsPrefs = {};
    await bg.poll(false);
    assert.strictEqual(notes.length, 1);
    assert.ok(areas.local.newsSeen.notified.includes("7:2") && badge.at(-1) === "1");
  }
  const box = { hidden: true, innerHTML: "", scrollIntoView() {} };
  const ctx = vm.createContext({
    toldBox: box, esc: String, newsOnOurSite: api.newsOnOurSite, newsAlertLists: api.newsAlertLists, takenBadge: () => "", state: { access: {}, sites, foreignNews: true },
    newsPrefs: async () => ({ hours: 6 }),
    // a row: the story's id, and «+» when it would carry the button
    dashStory: (s) => `${s.id}${"mark" in s && s.mark?.status !== "taken" ? "+" : ""},`,
  });
  vm.runInContext(text.slice(text.indexOf("let toldGo = null;"), text.indexOf('toldBox.addEventListener("click", (e) => {\n  if (!e.target.closest("#told-close")')) + "this.out = { showTold, refreshTold };", ctx);
  const rows = () => box.innerHTML.match(/<ul class="need">(.*)<\/ul>/)[1];
  const stale = [1, 2, 3].map((id) => ({ id, title: "t", mark: null }));
  ctx.out.showTold({ tab: "dash", title: "t", stories: stale });
  assert.strictEqual(rows(), "1,2,3,");
  await new Promise((done) => setTimeout(done, 10));
  // 1 was taken since, 2 is still free, 3 is on no list any more
  assert.strictEqual(rows(), "1,2+,3,");
  assert.ok(asked.includes("gap?siteId=7&hours=6"));
  // a foreign notification's stories are looked for in the foreign list only: 3 is there, free
  ctx.out.showTold({ tab: "global", title: "t", stories: stale });
  await new Promise((done) => setTimeout(done, 10));
  assert.strictEqual(rows(), "1,2,3+,");
  console.log("ok");
})().catch((error) => { console.error(error); process.exit(1); });
