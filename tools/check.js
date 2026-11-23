// node tools/check.js: the checks of api.js that need no browser. Exits 1 on the first failure.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// api.js is a plain script of function declarations (the background loads it with importScripts)
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

console.log("ok");
