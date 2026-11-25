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

console.log("ok");
