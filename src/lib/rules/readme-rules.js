// src/lib/rules/readme-rules.js
//
// Эвристики по README. Каждое правило — { id, weight, score(ctx), reason }.
// score() возвращает [0..1], где 1 = сильный AI-сигнал.
// Веса нормируются позже в scorer.js.

// Age-decay: старый репо с template-структурой ≠ AI. Возможно, человек
// просто заботливо обновлял README годами. Применяется к "поверхностным"
// сигналам — каноничной структуре, эмодзи, multi-lang и т.п.
function ageDecay(ctx) {
  const age = ctx.repoAgeDays || 0;
  if (age > 3 * 365) return 0.25;
  if (age > 2 * 365) return 0.45;
  if (age > 365)     return 0.65;
  if (age > 180)     return 0.85;
  return 1.0;
}

const AI_PHRASES_EN = [
  // Specific LLM tells — оставляем только то, что почти не используется людьми
  'comprehensive', 'seamlessly', 'leverage', 'robust', 'cutting-edge',
  'state-of-the-art', 'elegant', 'intuitive', 'streamline',
  'empower', 'unlock', 'harness', 'effortlessly', 'meticulously',
  'in the realm of', 'navigate the complexities', 'delve into',
  'a testament to', 'underscore',
  'this project aims to', 'designed to provide', 'built with the goal of',
  'whether you are', 'this repository contains',
  // 'powerful', 'modern' — убраны: дублируются с hyperbolic_opening и часто
  // встречаются в честных тех-описаниях ("powerful API", "modern UI")
  // 'pivotal', 'paramount' — убраны: редко в реальном LLM-output, шумные
];

// AI на русском: компактный словарь только специфичных LLM-формулировок.
// Общеупотребительные слова ("позволяет", "удобный", "автоматически",
// "современный") убраны — на ranom test corpus они срабатывали на human-репо
// и были анти-сигналом.
const AI_PHRASES_RU = [
  'представляет собой', 'является',
  'из коробки', 'под капотом',
  'благодаря этому', 'таким образом',
  'данный проект', 'данное решение', 'данная библиотека',
  'стоит отметить', 'следует учитывать',
  'полностью настраиваемый', 'высокопроизводительный',
  'интуитивно понятный', 'интуитивно понятная',
];

function detectLanguage(text) {
  // Грубо: считаем долю кириллицы среди буквенных символов
  const letters = (text.match(/[a-zа-яё]/gi) || []).length;
  if (!letters) return 'en';
  const cyrillic = (text.match(/[а-яё]/gi) || []).length;
  return cyrillic / letters > 0.35 ? 'ru' : 'en';
}

const EMOJI_HEADER_PATTERN = /^#{1,3}\s+[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gmu;
const EM_DASH_PATTERN = /—/g;
const PERFECT_TOC = /(table of contents|## contents)[\s\S]{0,40}\n(\s*[-*]\s+\[.+?\]\(#.+?\)\s*\n){4,}/i;

export const readmeRules = [
  {
    id: 'emoji_headers',
    weight: 0.3,  // дальше ослаблен: 3-4 эмодзи у русских READMEs — норма
    description: 'Эмодзи-заголовки паттерном `## 🚀 Getting Started`',
    score(ctx) {
      const n = (ctx.readme.match(EMOJI_HEADER_PATTERN) || []).length;
      // До 4 эмодзи-заголовков — нормально для русскоязычного README.
      // Сигнал начинается с 5+.
      if (n < 5) return 0;
      return Math.min(1, (n - 4) / 5) * ageDecay(ctx);
    },
    reason: (ctx) => {
      const n = (ctx.readme.match(EMOJI_HEADER_PATTERN) || []).length;
      return n >= 5 ? `${n} эмодзи-заголовков` : `${n} эмодзи-заголовков (норма)`;
    },
  },

  {
    id: 'ai_phrase_density',
    weight: 0.8,  // снижен с 1.4: словарь точнее, но всё ещё шумный
    description: 'Плотность типичных LLM-фраз (EN/RU)',
    score(ctx) {
      const text = ctx.readme.toLowerCase();
      const words = text.split(/\s+/).length || 1;
      const lang = detectLanguage(text);
      const dict = lang === 'ru' ? AI_PHRASES_RU : AI_PHRASES_EN;
      let hits = 0;
      const found = [];
      for (const phrase of dict) {
        const re = new RegExp(`(^|[^а-яёa-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^а-яёa-z]|$)`, 'gi');
        const occurrences = (text.match(re) || []).length;
        if (occurrences) {
          hits += occurrences;
          found.push(phrase);
        }
      }
      const density = hits / words;
      const multiplier = lang === 'ru' ? 100 : 80;
      ctx._aiPhraseFound = found;
      ctx._aiPhraseLang = lang;
      return Math.min(1, density * multiplier);
    },
    reason: (ctx) => {
      const found = ctx._aiPhraseFound || [];
      const lang = ctx._aiPhraseLang || 'en';
      return found.length
        ? `[${lang}] ${found.slice(0, 6).join(', ')}${found.length > 6 ? '…' : ''}`
        : 'LLM-фраз не найдено';
    },
  },

  {
    id: 'em_dash_density',
    weight: 0.7,
    description: 'Плотность em-dash (—). LLM любят их, люди обычно ставят --',
    score(ctx) {
      const matches = (ctx.readme.match(EM_DASH_PATTERN) || []).length;
      const lines = ctx.readme.split('\n').length || 1;
      return Math.min(1, (matches / lines) * 5);
    },
    reason: (ctx) => {
      const n = (ctx.readme.match(EM_DASH_PATTERN) || []).length;
      return `${n} em-dash на ${ctx.readme.split('\n').length} строк`;
    },
  },

  {
    id: 'perfect_structure',
    weight: 1.0,
    description: 'Идеальная структура README (Installation/Usage/Features/Contributing/License/API)',
    score(ctx) {
      const r = ctx.readme.toLowerCase();
      // Регексы толерантны к emoji-префиксу между ## и keyword: `## 🚀 Installation`
      // Это критично, потому что AI почти всегда ставит эмодзи в заголовки.
      // [^\n]{0,8}? — пропускаем до 8 символов (эмодзи + пробел) перед keyword.
      const sections = [
        /^#{1,3}[^\S\n][^\n]{0,8}?(installation|getting started|setup|установка)\b/m,
        /^#{1,3}[^\S\n][^\n]{0,8}?(usage|how to use|quick start|использование|быстрый старт)\b/m,
        /^#{1,3}[^\S\n][^\n]{0,8}?(features|key features|возможности|функции)\b/m,
        /^#{1,3}[^\S\n][^\n]{0,8}?(contributing|разработка|участие)\b/m,
        /^#{1,3}[^\S\n][^\n]{0,8}?(license|лицензия|лицензии)\b/m,
        /^#{1,3}[^\S\n][^\n]{0,8}?(api|api reference|api-?документация)\b/m,
      ];
      const found = sections.filter(re => re.test(r)).length;
      const isYoung = ctx.repoAgeDays < 14;
      // Считаем 4/6 как полную каноничную структуру; >4 → 1.0
      const base = Math.min(1, found / 4);
      const young = isYoung ? Math.min(1, base * 1.4) : base * 0.6;
      return young * ageDecay(ctx);
    },
    reason: (ctx) => {
      const r = ctx.readme.toLowerCase();
      const labels = ['installation', 'usage', 'features', 'contributing', 'license', 'api'];
      const found = labels.filter((_, i) => {
        const regs = [
          /^#{1,3}[^\S\n][^\n]{0,8}?(installation|getting started|setup|установка)\b/m,
          /^#{1,3}[^\S\n][^\n]{0,8}?(usage|how to use|quick start|использование|быстрый старт)\b/m,
          /^#{1,3}[^\S\n][^\n]{0,8}?(features|key features|возможности|функции)\b/m,
          /^#{1,3}[^\S\n][^\n]{0,8}?(contributing|разработка|участие)\b/m,
          /^#{1,3}[^\S\n][^\n]{0,8}?(license|лицензия|лицензии)\b/m,
          /^#{1,3}[^\S\n][^\n]{0,8}?(api|api reference|api-?документация)\b/m,
        ];
        return regs[i].test(r);
      });
      return `Канонических секций: ${found.length} (${found.join(', ')}), возраст ${ctx.repoAgeDays}д`;
    },
  },

  {
    id: 'has_perfect_toc',
    weight: 0.8,
    description: 'Развёрнутый TOC с якорными ссылками — редкость у людей',
    score(ctx) {
      return PERFECT_TOC.test(ctx.readme) ? 1 : 0;
    },
    reason: () => 'Подробный Table of Contents с anchor-ссылками',
  },

  {
    id: 'feature_checkmark_table',
    weight: 0.6,
    description: 'Таблицы фич с ✅/❌',
    score(ctx) {
      const hasChecks = /\|.*[✅❌].*\|/.test(ctx.readme);
      const hasComparisonTable = /\|[\s\S]{0,200}\|[\s\S]{0,200}\|[\s\S]{0,200}\n\|\s*-+/.test(ctx.readme);
      return hasChecks && hasComparisonTable ? 1 : (hasChecks ? 0.5 : 0);
    },
    reason: () => 'Comparison-таблица с галочками',
  },

  {
    id: 'inline_feature_bullets',
    weight: 0.7,
    description: '✅/🚀/⭐ галочки и эмодзи в начале параграфов (не в таблице) — AI feature highlights',
    score(ctx) {
      const r = ctx.readme;
      // Считаем строки, начинающиеся с галочки/эмодзи (вне таблиц).
      // ✅ / ❌ / 🚀 / ⭐ / 🎯 / 💡 / 🔍 — типичные AI "feature highlights"
      const lines = r.split('\n');
      let bulletLines = 0;
      for (const l of lines) {
        // skip строки таблиц (с |) и кодоблоки
        if (l.includes('|')) continue;
        // markdown bullet с эмодзи в начале содержимого: "- ✅ ..." тоже считается
        if (/^\s*(?:[-*]\s+)?[✅❌🚀⭐🎯💡🔍✨🎉]\s+\w/u.test(l)) bulletLines++;
      }
      if (bulletLines >= 6) return 1;
      if (bulletLines >= 4) return 0.7;
      if (bulletLines >= 2) return 0.3;
      return 0;
    },
    reason(ctx) {
      const lines = ctx.readme.split('\n');
      let n = 0;
      for (const l of lines) {
        if (l.includes('|')) continue;
        if (/^\s*(?:[-*]\s+)?[✅❌🚀⭐🎯💡🔍✨🎉]\s+\w/u.test(l)) n++;
      }
      return n >= 2 ? `${n} параграфов с emoji-галочками` : '';
    },
  },

  {
    id: 'hyperbolic_opening',
    weight: 0.9,
    description: 'Маркетинговое вступление — гиперболические эпитеты и прямые обращения к читателю',
    score(ctx) {
      // Расширили scope с 600 до 2500 chars: AI часто начинает README с logo+badges,
      // а сам маркетинговый текст идёт после.
      const opening = ctx.readme.slice(0, 2500).toLowerCase();
      const tells = [
        // Эпитеты
        'revolutionary', 'game-changing', 'cutting-edge', 'next-generation',
        'powerful', 'modern', 'beautiful', 'lightning-fast', 'blazingly fast',
        'enterprise-grade', 'production-ready', 'best-in-class', 'world-class',
        // Маркетинговые приёмы и обращения
        'tired of', 'imagine having', 'imagine if', 'just say', 'no problem!',
        'love at first sight', 'fall in love', "you'll love", 'you will love',
        'simple yet powerful', 'for beginners', 'in just a',
        'meet the', 'meet our', 'introducing',
        "you'll get", 'you get a whole world',
        "let's", 'why settle',
      ];
      const found = tells.filter(t => opening.includes(t));
      ctx._hyperbolicFound = found;
      return Math.min(1, found.length / 3);
    },
    reason: (ctx) => {
      const found = ctx._hyperbolicFound || [];
      return found.length ? `Маркетинговые tells: ${found.slice(0, 6).join(', ')}${found.length > 6 ? '…' : ''}` : '';
    },
  },

  {
    id: 'multi_language_readme',
    weight: 1.4,  // сильный сигнал: 5+ переводов README — почти всегда AI-генерация
    description: 'README переведён на 5+ языков (links на README.xx.md)',
    score(ctx) {
      // Считаем уникальные ссылки на README.{xx}.md или /xx/README.md
      const r = ctx.readme;
      const codes = new Set();
      const re1 = /\bREADME[._-]([a-z]{2,3})\.md\b/gi;
      const re2 = /\/([a-z]{2,3})\/README\.md\b/gi;
      const re3 = /\bREADME[_.-]([A-Z]{2,3})\b/g;
      for (const re of [re1, re2, re3]) {
        for (const m of r.matchAll(re)) codes.add(m[1].toLowerCase());
      }
      // Убираем явно невалидные коды (не язык)
      const blacklist = new Set(['md', 'old', 'tmp', 'bak', 'dev', 'src', 'lib']);
      for (const c of blacklist) codes.delete(c);
      // Multi-lang README — AI-специфичный паттерн независимо от возраста.
      // Люди обычно один раз пишут README и не добавляют переводы спустя
      // годы; AI же делает это вместе с самим READMЕ.
      if (codes.size >= 10) return 1;
      if (codes.size >= 5)  return 0.8;
      if (codes.size >= 3)  return 0.4;
      return 0;
    },
    reason(ctx) {
      const r = ctx.readme;
      const codes = new Set();
      for (const m of r.matchAll(/\bREADME[._-]([a-z]{2,3})\.md\b/gi)) codes.add(m[1].toLowerCase());
      for (const m of r.matchAll(/\/([a-z]{2,3})\/README\.md\b/gi))    codes.add(m[1].toLowerCase());
      const blacklist = new Set(['md', 'old', 'tmp', 'bak', 'dev', 'src', 'lib']);
      for (const c of blacklist) codes.delete(c);
      return codes.size ? `${codes.size} переводов README: ${[...codes].slice(0, 8).join(', ')}${codes.size > 8 ? '…' : ''}` : '';
    },
  },

  {
    id: 'excessive_badges',
    weight: 0.5,
    description: 'Гирлянда shields.io badges в шапке README',
    score(ctx) {
      const opening = ctx.readme.slice(0, 2500);
      const matches = (opening.match(/!\[[^\]]*\]\(https:\/\/img\.shields\.io\//gi) || []).length;
      // 3-5 — норма (CI/coverage/version); 7+ — украшательство в AI-стиле.
      // Без age-decay: AI любит badges независимо от возраста проекта.
      if (matches >= 8) return 1;
      if (matches >= 6) return 0.6;
      if (matches >= 4) return 0.25;
      return 0;
    },
    reason(ctx) {
      const opening = ctx.readme.slice(0, 2500);
      const n = (opening.match(/!\[[^\]]*\]\(https:\/\/img\.shields\.io\//gi) || []).length;
      return n >= 4 ? `${n} shields.io badges в шапке` : '';
    },
  },

  {
    id: 'excessive_collapsibles',
    weight: 0.6,
    description: 'Много <details><summary> — AI любит "схлопывать" разделы для красоты',
    score(ctx) {
      const n = (ctx.readme.match(/<details\b/gi) || []).length;
      if (n >= 8) return 1;
      if (n >= 5) return 0.6;
      if (n >= 3) return 0.25;
      return 0;
    },
    reason(ctx) {
      const n = (ctx.readme.match(/<details\b/gi) || []).length;
      return n >= 3 ? `${n} <details>-блоков в README` : '';
    },
  },

  {
    id: 'ascii_tree_in_readme',
    weight: 0.7,
    description: 'ASCII-дерево проекта с эмодзи и комментариями (типичный AI-overdoc)',
    score(ctx) {
      const r = ctx.readme;
      // Считаем ├── / └── / │ символы в любых блоках кода
      const treeChars = (r.match(/[├└│]──/g) || []).length;
      if (!treeChars) return 0;
      // Усиление, если рядом эмодзи на строках дерева
      const emojiOnTree = (r.match(/[├└│]──[ \t]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
      if (treeChars >= 15 && emojiOnTree >= 5) return 1;       // явно overdoc
      if (treeChars >= 10)                     return 0.6;
      if (treeChars >= 5)                      return 0.3;
      return 0;
    },
    reason(ctx) {
      const n = (ctx.readme.match(/[├└│]──/g) || []).length;
      const e = (ctx.readme.match(/[├└│]──[ \t]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
      return n >= 5 ? `ASCII-дерево с ${n} веток${e ? `, эмодзи на ${e}` : ''}` : '';
    },
  },
];
