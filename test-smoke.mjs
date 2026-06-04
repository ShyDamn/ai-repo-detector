// Smoke-тест на синтетических ctx, эмулирующих описанные кейсы.
// Без реальных API-вызовов — проверяем только логику правил и scorer.

import { analyze } from './src/lib/scorer.js';

function mkCommit({ msg, name = 'human', email = 'human@example.com', date = '2025-01-01T00:00:00Z' }) {
  return {
    sha: Math.random().toString(36).slice(2, 10),
    commit: {
      message: msg,
      author: { name, email, date },
      committer: { name, email, date },
    },
  };
}

// Кейс 1: opendataloader-pdf — 12 из 20 коммитов содержат Co-Authored-By: Claude
const opendataloader = {
  repo: {
    size: 800,
    stargazers_count: 50,
    open_issues_count: 3,
    description: 'PDF parser',
    topics: ['pdf', 'parser'],
    homepage: '',
    created_at: '2025-08-01T00:00:00Z',
  },
  readme: '# OpenDataLoader PDF\n\nParser for PDFs. See docs.\n',
  commits: [
    // 12 коммитов с trailer
    ...Array.from({ length: 12 }, (_, i) => mkCommit({
      msg: `fix(parser): improve table extraction ${i}\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`,
      name: 'bundolee',
      date: new Date(2025, 9 + Math.floor(i / 4), 1 + (i % 28)).toISOString(),
    })),
    // 8 чистых коммитов
    ...Array.from({ length: 8 }, (_, i) => mkCommit({
      msg: i % 2 === 0 ? `chore: bump version ${i}` : `update docs ${i}`,
      name: 'bundolee',
      date: new Date(2025, 9 + Math.floor(i / 3), 1 + (i % 28)).toISOString(),
    })),
  ],
  totalCommits: 80,
  pullRequestsCount: 5,
  rootTree: [
    { path: 'src', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: 'LICENSE', type: 'blob' },
    { path: 'package.json', type: 'blob' },
  ],
  repoAgeDays: 120,
};

// Кейс 2: Timetable-bot — README AI-шный, но код человеческий
const timetableBot = {
  repo: {
    size: 300,
    stargazers_count: 12,
    open_issues_count: 2,
    description: 'Telegram bot for class timetable',
    topics: ['telegram', 'bot'],
    homepage: '',
    created_at: '2024-06-01T00:00:00Z',
  },
  // Жирный AI-шный README — много эмодзи, идеальная структура, TOC, маркетинг
  readme: `# 🤖 Timetable Bot — Революционный Telegram-бот

> Powerful, production-ready telegram-бот для управления расписанием

## 📋 Table of Contents
- [Возможности](#возможности)
- [Установка](#установка)
- [Использование](#использование)
- [Архитектура](#архитектура)
- [Лицензия](#лицензия)

## ✨ Возможности
Данный проект представляет собой comprehensive решение, которое seamlessly
интегрируется с Telegram API. Под капотом — robust механизм parsing'а.

| Feature | Status |
|---------|--------|
| Расписание | ✅ |
| Уведомления | ✅ |
| Экспорт в .ics | ❌ |

## 🚀 Установка
\`\`\`bash
pip install -r requirements.txt
\`\`\`

## 💻 Использование
Запустите бота — он автоматически подхватит конфигурацию.

## 🏗 Архитектура
Стоит отметить — благодаря этому подходу мы достигли максимальной
производительности. Высокопроизводительная архитектура из коробки.

## 📜 Лицензия
MIT`,
  // 30+ человеческих коммитов, без trailers
  commits: Array.from({ length: 30 }, (_, i) => mkCommit({
    msg: i % 3 === 0
      ? `add new feature ${i}`
      : i % 3 === 1
      ? `fix bug in handler ${i}`
      : `wip`,
    name: 'shydamn',
    date: new Date(2024, 6 + Math.floor(i / 5), 1 + (i % 28)).toISOString(),
  })),
  totalCommits: 120,
  pullRequestsCount: 0,
  rootTree: [
    { path: 'src', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: 'requirements.txt', type: 'blob' },
  ],
  repoAgeDays: 200,
};

// Кейс 3: figma/mcp-server-guide — 20% коммитов с Claude trailer, это human репо.
// Реалистично: даты разнесены, message-стили смешаны (не все conventional).
const figmaMcp = {
  repo: {
    size: 500,
    stargazers_count: 200,
    open_issues_count: 10,
    description: 'Figma MCP server guide',
    topics: ['mcp', 'figma'],
    homepage: 'https://www.figma.com',
    created_at: '2025-04-01T00:00:00Z',
  },
  readme: '# Figma MCP Server Guide\n\nThis guide covers...\n',
  commits: [
    ...Array.from({ length: 4 }, (_, i) => mkCommit({
      msg: `feat: add helper ${i}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
      name: 'human-dev',
      date: new Date(2025, 4 + i, 5).toISOString(),
    })),
    ...Array.from({ length: 16 }, (_, i) => mkCommit({
      // смесь: половина conventional, половина свободная
      msg: i % 2 === 0 ? `chore: misc ${i}` : `update something ${i}`,
      name: 'human-dev',
      date: new Date(2025, 4 + Math.floor(i / 3), 1 + (i % 28)).toISOString(),
    })),
  ],
  totalCommits: 50,
  pullRequestsCount: 8,
  rootTree: [
    { path: 'src', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: 'LICENSE', type: 'blob' },
  ],
  repoAgeDays: 60,
};

// Кейс 4: классический vibe-coded — 2 коммита, молодой, всё AI
const vibeCoded = {
  repo: {
    size: 800,
    stargazers_count: 1,
    open_issues_count: 0,
    description: 'A revolutionary AI-powered task manager built with cutting-edge tech',
    topics: [],
    homepage: '',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  readme: `# 🚀 TaskFlow AI — Revolutionary Task Management

> Cutting-edge, production-ready, blazingly fast task manager

## 📋 Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features
This project leverages comprehensive state-of-the-art AI to seamlessly empower users.

| Feature | Status |
|---------|--------|
| AI tasks | ✅ |
| Sync | ✅ |
| Mobile | ❌ |

## 🛠 Installation
\`\`\`bash
npm install
\`\`\`

## 💡 Usage
Designed to provide an elegant, intuitive experience.

## 🤝 Contributing
PRs welcome.

## 📜 License
MIT`,
  commits: [
    mkCommit({
      msg: 'feat: initial implementation\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      name: 'someone',
    }),
    mkCommit({
      msg: 'fix: typo',
      name: 'someone',
    }),
  ],
  totalCommits: 2,
  pullRequestsCount: 0,
  rootTree: [
    { path: 'src', type: 'tree' },
    { path: 'tests', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: '.github', type: 'tree' },
    { path: '.github/workflows', type: 'tree' },
    { path: 'CODE_OF_CONDUCT.md', type: 'blob' },
    { path: 'SECURITY.md', type: 'blob' },
    { path: 'CONTRIBUTING.md', type: 'blob' },
    { path: '.editorconfig', type: 'blob' },
    { path: '.prettierrc', type: 'blob' },
    { path: 'tsconfig.json', type: 'blob' },
  ],
  repoAgeDays: 5,
};

const cases = [
  { name: 'opendataloader-pdf (ground truth: AI, 60% trailers)', ctx: opendataloader, expectProfile: ['ai_code', 'ai_full'] },
  { name: 'Timetable-bot (ground truth: human, README AI)',     ctx: timetableBot,    expectProfile: ['ai_docs_only', 'ai_polish_only', null] },
  { name: 'figma/mcp-server-guide (ground truth: human, 20% trailers)', ctx: figmaMcp, expectProfile: [null] },
  { name: 'vibe-coded synthetic (ground truth: AI)',            ctx: vibeCoded,       expectProfile: ['ai_full', 'ai_code'] },
];

// Кейс 5: YTSage-style — большой активный human-проект, AI-полированный README
// (много emoji-headers, 14 переводов, кучи details, ASCII-дерево с эмодзи)
const ytsageStyle = {
  repo: {
    size: 2500,
    stargazers_count: 3694,
    open_issues_count: 12,
    description: 'Modern YouTube downloader with clean PySide6 interface',
    topics: ['youtube', 'downloader', 'yt-dlp'],
    homepage: 'https://pypi.org/project/ytsage/',
    created_at: '2024-08-01T00:00:00Z',
  },
  readme: [
    '# YTSage',
    '[![Python](https://img.shields.io/badge/python-blue)](#)',
    '[![Downloads](https://img.shields.io/pepy/dt/ytsage)](#)',
    '[![GitHub Downloads](https://img.shields.io/github/downloads/oop7/YTSage/total)](#)',
    '[![License: MIT](https://img.shields.io/badge/License-MIT)](#)',
    '[![Platforms](https://img.shields.io/badge/platform-cross--platform)](#)',
    '[![Stars](https://img.shields.io/github/stars/oop7/YTSage)](#)',
    '[![PyPI](https://img.shields.io/pypi/v/ytsage)](#)',
    '[![Sponsors](https://img.shields.io/github/sponsors/oop7)](#)',
    '',
    'English: [EN](README.md) | Arabic: [AR](README.ar.md) | German: [DE](README.de.md) | Spanish: [ES](README.es.md) | French: [FR](README.fr.md) | Hindi: [HI](README.hi.md) | Indonesian: [ID](README.id.md) | Italian: [IT](README.it.md) | Japanese: [JA](README.ja.md) | Polish: [PL](README.pl.md) | Portuguese: [PT](README.pt.md) | Russian: [RU](README.ru.md) | Turkish: [TR](README.tr.md) | Chinese: [ZH](README.zh.md)',
    '',
    '## ❓ Why YTSage?',
    'YTSage is a simple yet powerful YouTube downloader.',
    '## ✨ Features',
    '## 🚀 Installation',
    '### ⚡ Quick Install',
    '### 📦 Pre-built Executables',
    '## 📸 Screenshots',
    '## 📖 Usage',
    '<details><summary>🎯 Basic Usage</summary>...</details>',
    '<details><summary>📋 Playlist Download</summary>...</details>',
    '<details><summary>🌍 Generic Mode</summary>...</details>',
    '<details><summary>🧰 Media Options</summary>...</details>',
    '<details><summary>⚙️ Output Settings</summary>...</details>',
    '<details><summary>🌐 Access & Network</summary>...</details>',
    '<details><summary>🛠️ Tools</summary>...</details>',
    '<details><summary>🌍 Localization</summary>...</details>',
    '## 🛠️ Troubleshooting',
    '## 💖 Sponsor',
    '## 👥 Contributing',
    '<details><summary>📂 Project Structure</summary>',
    '```',
    'YTSage/',
    '├── 📁 .github/        # GitHub config',
    '│   ├── 📁 ISSUE_TEMPLATE/',
    '│   └── 📁 workflows/',
    '├── 📁 branding/',
    '│   ├── 📁 icons/',
    '│   └── 📁 screenshots/',
    '├── 📄 LICENSE',
    '├── 📄 pyproject.toml',
    '├── 📄 README.md',
    '└── 📁 ytsage/',
    '    ├── 📁 core/',
    '    ├── 📁 gui/',
    '    └── 📁 utils/',
    '```',
    '</details>',
    '## 📜 License',
    '## 🙏 Acknowledgments',
  ].join('\n'),
  commits: Array.from({ length: 30 }, (_, i) => mkCommit({
    msg: `fix: bug ${i}`,
    name: 'oop7',
    date: new Date(2024, 8 + Math.floor(i / 5), 1 + (i % 28)).toISOString(),
  })),
  totalCommits: 569,
  pullRequestsCount: 50,
  rootTree: [
    { path: 'ytsage', type: 'tree' },
    { path: '.github', type: 'tree' },
    { path: 'branding', type: 'tree' },
    { path: 'readme-translations', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: 'LICENSE', type: 'blob' },
    { path: 'pyproject.toml', type: 'blob' },
    { path: 'requirements.txt', type: 'blob' },
  ],
  repoAgeDays: 670,
};

// Кейс 6: synapsea-auth-react-style — 5 коммитов, TS SDK, dist/+src+package.json,
// каноничная SDK-структура README, ноль звёзд
const synapseaSdk = {
  repo: {
    size: 80,
    stargazers_count: 0,
    open_issues_count: 0,
    description: '',
    topics: [],
    homepage: '',
    created_at: '2025-11-01T00:00:00Z',
  },
  readme: [
    '# @synapsea/auth-react',
    '',
    'React SDK для Synapsea Auth — Auth-as-a-Service платформа.',
    '',
    '## Установка',
    '```bash',
    'npm install @synapsea/auth-react',
    '```',
    '',
    '## Быстрый старт',
    '```jsx',
    'import { SynapseaAuthProvider } from "@synapsea/auth-react";',
    '```',
    '',
    '## API',
    '### `SynapseaAuthProvider`',
    '| Prop | Тип | Описание |',
    '| ---- | --- | -------- |',
    '| `config.apiKey` | `string` | API-ключ |',
    '',
    '## Лицензия',
    'Проприетарное ПО.',
  ].join('\n'),
  commits: Array.from({ length: 5 }, (_, i) => mkCommit({
    msg: i === 0 ? 'feat: initial implementation' : `chore: update ${i}`,
    name: 'ShyDamn',
    date: new Date(2025, 10, 1 + i).toISOString(),
  })),
  totalCommits: 5,
  pullRequestsCount: 0,
  rootTree: [
    { path: 'dist', type: 'tree' },
    { path: 'src', type: 'tree' },
    { path: '.gitignore', type: 'blob' },
    { path: 'LICENSE', type: 'blob' },
    { path: 'README.md', type: 'blob' },
    { path: 'package-lock.json', type: 'blob' },
    { path: 'package.json', type: 'blob' },
    { path: 'tsconfig.json', type: 'blob' },
  ],
  repoAgeDays: 35,
};

cases.push(
  { name: 'YTSage-style (active human code, AI-polished README)', ctx: ytsageStyle,  expectProfile: ['ai_docs_only', 'ai_polish_only'] },
  { name: 'synapsea-auth-react-style (5 commits, TS SDK)',        ctx: synapseaSdk,  expectProfile: ['ai_code', 'ai_full'] },
);

let pass = 0, fail = 0;
for (const c of cases) {
  const result = analyze(c.ctx);
  const ok = c.expectProfile.includes(result.profile);
  console.log('─'.repeat(80));
  console.log(c.name);
  console.log(`  overall=${result.overall}  profile=${result.profile}  verdict="${result.verdict.label}"`);
  console.log(`  categories: readme=${result.categories.readme.score}  commits=${result.categories.commits.score}  meta=${result.categories.meta.score}  files=${result.categories.files.score}`);
  const topRules = Object.entries(result.categories)
    .flatMap(([cat, r]) => r.details.map(d => ({ cat, ...d })))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
  console.log('  top rules:');
  for (const r of topRules) {
    console.log(`    [${r.cat}] ${r.id} raw=${(r.raw * 100).toFixed(0)}%  weight=${r.weight}  — ${r.reason}`);
  }
  console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'} (expected profile ∈ ${JSON.stringify(c.expectProfile)})`);
  ok ? pass++ : fail++;
}
console.log('─'.repeat(80));
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
