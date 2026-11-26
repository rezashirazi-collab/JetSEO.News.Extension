// node tools/check.js: the checks of api.js that need no browser. Exits 1 on the first failure.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// api.js is a plain script of top-level declarations, no module (the background loads it with importScripts): its
// functions become the context's own
const api = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8"), api);

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

// The story prompts (panel.js, which needs a browser: only the block from NO_ANGLES to addAngles is run here). Each
// kind names its story and its links, says what only it says, and keeps one place for «مردم چه می‌پرسند؟».
const panel = fs.readFileSync(path.join(__dirname, "..", "panel.js"), "utf8");
const prompts = vm.createContext({ fa: (n) => String(n), esc: (s) => String(s) });
vm.runInContext(panel.slice(panel.indexOf("const NO_ANGLES"), panel.indexOf("// the card's copy carries")) + "this.out = { storyPrompt, NO_ANGLES, PROMPT_OUTPUT, PROMPT_KINDS, PROMPT_FORMATS, promptAs };", prompts);
const { storyPrompt, NO_ANGLES, PROMPT_OUTPUT, PROMPT_KINDS, PROMPT_FORMATS, promptAs } = prompts.out;
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
// saw, only from the story as the server has it now; a foreign notification asks only the foreign list.
(async () => {
  const text = panel.replace(/\r\n/g, "\n");
  const asked = [];
  const lists = { "topics?hours=3&minSources=1": [{ id: 1, title: "a", mark: { status: "taken", by: "همکار" } }], "gap?siteId=7&hours=6": [{ id: 2, title: "b", mark: null }] };
  const box = { hidden: true, innerHTML: "", scrollIntoView() {} };
  const ctx = vm.createContext({
    toldBox: box, esc: String, newsOnOurSite: api.newsOnOurSite, NEWS_WATCH_PATHS: api.NEWS_WATCH_PATHS, NEWS_FOREIGN_WATCH_PATH: api.NEWS_FOREIGN_WATCH_PATH, takenBadge: () => "", state: { access: {}, sites: [{ id: 7, hasFeed: true, competitors: 2 }, { id: 8 }] },
    newsPrefs: async () => ({ hours: 6 }),
    newsApi: async (p) => (asked.push(p), lists[p] ? { status: 200, data: { stories: lists[p] } } : { status: 500 }),
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
  assert.ok(asked.includes("gap?siteId=7&hours=6") && !asked.some((p) => p.includes("siteId=8") || p.startsWith("foreign")));
  asked.length = 0;
  ctx.out.showTold({ tab: "global", title: "t", stories: stale });
  await new Promise((done) => setTimeout(done, 10));
  assert.deepStrictEqual(asked, ["foreign?hours=6"]);
  console.log("ok");
})().catch((error) => { console.error(error); process.exit(1); });
