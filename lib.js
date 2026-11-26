// «جت‌سئو نیوز»: the panel's rules that need no page (what a headline lacks, a headline's media kind, a phrase's type,
// a story's prompt). Loaded by panel.html after api.js (newsFold) and before panel.js; `node tools/check.js` runs them.
// Plain declarations at the top level, like api.js.

const fa = (n) => Number(n).toLocaleString("fa-IR");

// «20K+», «۲ هزار+» → a number for the bar's length; ponytail: Google's rounded buckets, good only for relative size
function trafficNumber(text) {
  const s = String(text ?? "").replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[,٬]/g, "");
  const m = s.match(/([\d.]+)\s*(k|m|هزار|میلیون)?/i);
  if (!m) return 0;
  return parseFloat(m[1]) * ({ k: 1e3, هزار: 1e3, m: 1e6, میلیون: 1e6 }[(m[2] ?? "").toLowerCase()] ?? 1);
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

const KW_ASK = ["چیست", "چرا", "چگونه", "چطور", "کی", "کجا", "چقدر", "چند", "آیا", "کدام"];
const KW_INFO_ASK = ["علت", "معنی", "ماجرای", "زمان", "نتیجه", "آموزش", "تفاوت", "امروز"];
// how a phrase found is told apart (whole words of the folded phrase)
const KW_QUESTION = new Set([...KW_ASK, "چیه", "چطوری", "چه", "کیست", "کیه", "کجاست", "چندمه", "چنده", "مگر"].map(newsFold));
const KW_INFO = new Set([...KW_INFO_ASK, "دلیل", "یعنی", "ماجرا", "جزئیات", "تاریخ", "ساعت", "نتایج", "خبر", "اخبار", "آخرین", "جدید", "نحوه", "روش", "راهنمای", "فرق", "زندگینامه", "بیوگرافی", "خلاصه"].map(newsFold));
const KW_TYPES = { question: "پرسشی", info: "اطلاعاتی", other: "سایر" };

function keywordType(phrase, informational) {
  const words = newsFold(phrase).split(" ");
  return words.some((w) => KW_QUESTION.has(w)) ? "question" : informational || words.some((w) => KW_INFO.has(w)) ? "info" : "other";
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

// The prompt of a story: what the card knows (headlines, sources, links, the trend), written as a prompt the user pastes
// into an AI assistant. One kind a card, by what the story is to the team:
//   new: a story to write; update: one of the team's sites already tells it («در سایت شما»); gap: its competitors told
//   it and the site did not (s.competitors); foreign: a story of «رسانه‌های خارجی», to be told in Persian.
// NO_ANGLES stands where the answers of «مردم چه می‌پرسند؟» go once the user asks for them (addAngles).
const NO_ANGLES = "(فهرستی در دست نیست؛ خودت پرسش‌ها و جستجوهای رایج مخاطب درباره این سوژه را پیدا کن.)";
const promptLinks = (items) => items.slice(0, 8).map((i) => `- ${i.source}: ${i.title}\n  ${i.url}`).join("\n");
// the last part of every prompt: what the assistant is to hand back
const PROMPT_OUTPUT = "خروجی را به همین ترتیب بده:";
const promptOutput = (list) => `${PROMPT_OUTPUT}\n${[...list, "در پایان: منابعی که استفاده کردی، و نکته‌هایی که تأیید نشده یا منابع درباره‌شان اختلاف دارند."].map((t) => `- ${t}`).join("\n")}`;
const PROMPT_ARTICLE = [
  "سه تیتر پیشنهادی: یکی خبری، یکی بر پایه پرسش مخاطب و یکی تحلیلی؛ هر کدام حداکثر ۶۵ نویسه. بگو کدام را پیشنهاد می‌کنی و چرا.",
  "لید: دو تا سه جمله که مهم‌ترین واقعیت خبر را بگوید.",
  "متن مطلب: ۴۰۰ تا ۷۰۰ کلمه، به سبک هرم وارونه، با میان‌تیتر و پاراگراف‌های کوتاه.",
];
const PROMPT_KINDS = {
  new: {
    hint: "متن آماده برای هوش مصنوعی کپی می‌شود: خبرها را می‌خواند، پرسش‌های مردم را در نظر می‌گیرد و تیتر، لید و متن می‌نویسد",
    task: "درباره سوژه زیر یک مطلب تازه و مستقل بنویس.",
    steps: [
      "واقعیت‌ها، عددها و نقل‌قول‌ها را از خبرها بیرون بکش و جایی را که منابع با هم اختلاف دارند مشخص کن.",
      "مطلب را طوری بچین که به پرسش‌های مردم پاسخ بدهد؛ پرسش‌های مهم‌تر میان‌تیتر شوند.",
      "زاویه‌ای پیدا کن که در خبرهای بالا کم‌رنگ است (پیامد برای مخاطب، پیشینه، قدم بعدی) تا مطلب تکرار آن‌ها نباشد.",
    ],
    output: PROMPT_ARTICLE,
  },
  update: {
    hint: "این سوژه در سایت شما هست: متنی کپی می‌شود که مطلب شما را با خبرهای تازه مقایسه می‌کند و می‌گوید چه چیزی اضافه یا اصلاح شود",
    task: "ما این سوژه را قبلاً منتشر کرده‌ایم. مطلب ما را با خبرهای زیر مقایسه کن و بگو چطور به‌روز شود.",
    extra: () => "مطلب ما:\n[نشانی یا متن مطلب خودتان را این‌جا بگذارید]",
    steps: [
      "مطلب ما و خبرها را بخوان و فهرست کن: چه چیز تازه‌ای آمده که در مطلب ما نیست، و چه چیزی در مطلب ما کهنه یا نادرست شده است.",
      "ببین کدام پرسش‌های مردم در مطلب ما بی‌پاسخ مانده است.",
      "مطلب را از نو ننویس؛ فقط همان بخش‌هایی را تغییر بده که لازم است.",
    ],
    output: [
      "فهرست تغییرها: چه چیزی اضافه، اصلاح یا حذف شود و هر کدام بر پایه کدام منبع.",
      "تیتر: اگر خبر تازه تیتر را کهنه کرده، یک تیتر تازه (حداکثر ۶۵ نویسه)؛ وگرنه بگو همان بماند.",
      "لید به‌روزشده.",
      "پاراگراف‌های تازه یا بازنویسی‌شده، با ذکر این‌که هر کدام کجای مطلب قرار می‌گیرد.",
    ],
  },
  gap: {
    hint: "رقبا این سوژه را زده‌اند: متنی کپی می‌شود که مطلب آن‌ها را می‌خواند و زاویه‌ای پیدا می‌کند که هیچ‌کدام نگفته‌اند",
    task: "رقبای ما این سوژه را منتشر کرده‌اند و ما نه. مطلبی بنویس که تکرار آن‌ها نباشد و چیزی بگوید که هیچ‌کدام نگفته‌اند.",
    extra: (s) => `رقبایی که این سوژه را زده‌اند: ${s.competitors.join("، ")}`,
    steps: [
      "خبرها را بخوان و برای هر کدام کوتاه بنویس چه گفته است؛ بعد فهرست کن چه چیزی را هیچ‌کدام نگفته‌اند (پیامد برای مخاطب، پیشینه، عدد و مقایسه، پرسش بی‌پاسخ مردم).",
      "از میان این جاهای خالی دو یا سه زاویه پیشنهاد بده و بهترین را برگزین؛ زاویه‌ای که بتوان با همین منابع از آن دفاع کرد.",
      "مطلب را با همان زاویه بنویس و پرسش‌های مهم‌تر مردم را میان‌تیتر کن.",
    ],
    output: [
      "هر منبع در یک خط: چه گفته است.",
      "زاویه‌های پیشنهادی، با دلیل انتخاب بهترین.",
      ...PROMPT_ARTICLE,
    ],
  },
  foreign: {
    hint: "متن آماده برای هوش مصنوعی کپی می‌شود: خبرهای انگلیسی را می‌خواند و برای مخاطب ایرانی تیتر، لید و متن فارسی می‌نویسد",
    task: "خبرهای انگلیسی زیر را بخوان و درباره این سوژه برای مخاطب ایرانی یک مطلب فارسی مستقل بنویس؛ ترجمه کلمه‌به‌کلمه نمی‌خواهم.",
    extra: (s) => {
      const persian = [...(s.ours ?? []), ...(s.covers ?? [])];
      return `تیترهای فارسی که تا حالا درباره این سوژه پیدا شده (مطلب تو نباید تکرار این‌ها باشد):\n${persian.length ? promptLinks(persian) : "(موردی پیدا نشد.)"}`;
    },
    steps: [
      "واقعیت‌ها، عددها و نقل‌قول‌ها را از خبرها بیرون بکش و جایی را که منابع با هم اختلاف دارند مشخص کن.",
      "روشن کن این خبر برای مخاطب ایرانی چه اهمیتی دارد و مطلب را طوری بچین که به پرسش‌های مردم پاسخ بدهد.",
      "نام‌ها و اصطلاح‌ها را با املای رایج فارسی بنویس و بار اول صورت لاتین را در پرانتز بیاور؛ واحدها و مبلغ‌ها را برای مخاطب ایرانی قابل‌فهم کن.",
    ],
    output: PROMPT_ARTICLE,
  },
};
function storyPrompt(s, kind) {
  const k = PROMPT_KINDS[kind];
  const first = s.firstSource ?? s.items?.[0]?.source;
  const steps = [...k.steps, "فقط از آنچه در منابع هست استفاده کن و چیزی از خودت نساز. جمله‌های منابع را کپی نکن؛ با بیان خودت بنویس و عدد و نقل‌قول را با نام منبع بیاور."];
  return [
    `تو خبرنگار و دبیر باتجربه یک رسانه فارسی‌زبان هستی و سئوی خبری را هم خوب می‌شناسی. ${k.task}`,
    [`سوژه: ${s.title}`,
      // like the card's count badge: a story may come with neither number
      [s.sources ? `${fa(s.sources)} منبع آن را پوشش داده‌اند` : s.channels ? `${fa(s.channels)} کانال آن را پوشش داده‌اند` : "", first ? `اولین: ${first}` : ""].filter(Boolean).join(" · "),
      s.trend ? `ترند ${s.trend.source}: ${s.trend.text}` : ""].filter(Boolean).join("\n"),
    k.extra?.(s),
    `خبرهای منتشرشده (همه را باز کن و کامل بخوان؛ اگر به وب دسترسی نداری، همین را بگو و متن خبرها را از من بخواه):\n${promptLinks(s.items ?? [])}`,
    `پرسش‌های مردم (آنچه مخاطب همراه این سوژه در گوگل جستجو می‌کند):\n${NO_ANGLES}`,
    `روش کار:\n${steps.map((t, i) => `${fa(i + 1)}. ${t}`).join("\n")}`,
    promptOutput(k.output),
  ].filter(Boolean).join("\n\n");
}

// The same prompt asking for something else than an article: offered under the card once its prompt is copied (not on
// an update: that one is about the article already published). promptAs swaps the last part of the prompt as it is
// then, so the answers of «مردم چه می‌پرسند؟» stay in.
const PROMPT_FORMATS = {
  telegram: {
    label: "پست تلگرام",
    output: [
      "پست تلگرام: حداکثر ۸۰۰ نویسه. خط اول یک تیتر کوتاه، بعد سه تا پنج جمله کوتاه با مهم‌ترین واقعیت‌ها؛ بدون مقدمه‌چینی و بدون تکرار تیتر.",
      "یک نسخه کوتاه‌تر از همان پست: حداکثر ۳۰۰ نویسه.",
      "دو یا سه هشتگ مرتبط، و در خط آخر جای لینک مطلب: [نشانی مطلب].",
    ],
  },
  discover: {
    label: "گوگل دیسکاور",
    output: [
      "پنج تیتر برای گوگل دیسکاور: هر کدام حداکثر ۷۰ نویسه، روشن و کنجکاوی‌برانگیز، ولی بدون طعمه کلیک؛ تیتر چیزی وعده ندهد که در خبر نیست.",
      "برای هر تیتر یک توضیح متا: ۱۲۰ تا ۱۵۵ نویسه.",
      "پیشنهاد عکس شاخص: چه تصویری با این تیترها جور است (افقی، دست‌کم ۱۲۰۰ پیکسل عرض).",
      "بگو کدام تیتر را پیشنهاد می‌کنی و چرا.",
    ],
  },
  faq: {
    label: "پرسش و پاسخ",
    output: [
      "پنج تا هشت پرسش که مخاطب واقعاً درباره این سوژه می‌پرسد (از پرسش‌های مردم شروع کن)، هر کدام به شکل یک میان‌تیتر.",
      "پاسخ هر پرسش در دو تا چهار جمله؛ پاسخ مستقیم در جمله اول بیاید.",
      "اگر منابع برای پرسشی پاسخ ندارند، همین را بگو («هنوز روشن نیست») و حدس نزن.",
    ],
  },
};
const promptAs = (text, format) => text.slice(0, text.lastIndexOf(PROMPT_OUTPUT)) + promptOutput(PROMPT_FORMATS[format].output);
