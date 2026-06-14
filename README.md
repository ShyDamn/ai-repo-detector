# AI Repo Detector

Chrome-расширение, которое **без использования ИИ** оценивает, насколько GitHub-репозиторий выглядит сгенерированным ИИ.

Не выдаёт бинарный вердикт «AI / не AI». Считает четыре независимых субскора (README, Commits, Meta, Files) и общий confidence 0–100. На странице репо висит бейдж, клик — раскрывается панель с разбором каждого сработавшего правила.

> ⚠ Это эвристический детектор. У него будут false positives и false negatives. Это не баг — это часть проекта. См. секцию [Что детектор НЕ ловит](#что-детектор-не-ловит).

## v0.4.1 — критический фикс по фидбеку

- **Snapshot detection.** README с `git clone https://github.com/<X>/...` где `<X>` ≠ владелец репо означает что этот репо — импорт/snapshot чужого проекта. В таком режиме form-сигналы (`polished_oneshot_sdk`, `vibe_coded_few_commits`) подавляются — они описывают чужой труд, а не AI-генерацию текущего юзера. Profile становится `ai_polish_only` / `ai_docs_only` если README действительно AI, иначе `null`. UI показывает в панели заметку с источником.
- **Direct vs indirect AI signals разделены.** Direct (trailers, scaffold marker, AI committer) → всегда триггерят AI код. Indirect (polished SDK form, vibe-few-commits) → только если не snapshot.

## v0.4 — что нового по фидбеку к статье

- **CI-боты больше не AI.** `github-actions[bot]`, `dependabot`, `renovate`, `mergify`, `pre-commit-ci`, `codecov`, `snyk`, `semantic-release-bot` — явный blacklist. Имя `Claude` без email с anthropic-доменом тоже не триггерит — у людей бывает такое имя.
- **Squash-merge counter-signal.** 3 коммита + 50 PRs больше не «vibe-coded». Сигнал гасится ×0.25 при PRs≥20 / commits≤10.
- **`over_engineered_skeleton` починен.** Жёсткий age-decay (×0.1 для репо старше 3 лет), универсальные `.editorconfig` / `.gitignore` / базовый `tsconfig.json` убраны из tooling-листа.
- **`orphan_repo` ослаблен.** Отсутствие homepage и topics больше не штрафуется. Остался только `description`.
- **`polished_oneshot_sdk` стал кросс-стек.** Python (`pyproject.toml`, `uv.lock`, `.pre-commit-config.yaml`), Rust (`Cargo.lock`), Go (`go.sum`), PHP (`phpstan.neon`), не только JS/TS. Solo-check по именам, игнорирует `root/user/admin/ubuntu/builder` — типичный artifact Docker/agent окружения, где AI делает initial commit.
- **`scaffold_initial_message`** — новое правило: ловит Claude-style многострочный initial commit с разделом "Features:" и bullet-list. Quintessential AI-tell.
- **Abandoned vibe** — если коммитов ≤10, PRs≤2, stars<10 — age-decay для `vibe_coded_few_commits` снимается. Заброшенный vibe-codedд проект не превращается в "old human project" со временем.
- **`hyperbolic_opening` расширен.** Scope с 600 до 2500 символов, словарь tells'ов вырос: "tired of", "imagine having", "love at first sight", "in just a", "you'll love", "simple yet powerful", "for beginners and"…
- **`inline_feature_bullets`** — новое правило: `✅ / 🚀 / ⭐ / 🎯 / 💡` в начале параграфов (не в таблицах). Типичный AI "feature highlight" формат.
- **Scaffold-маркер** (`🤖 Generated with Claude Code` в самом старом коммите) даёт raw ≥0.85 даже если потом дописывал человек.
- **Trailer threshold снижен** до 30% (было 50%) для перевода в `ai_code`.
- **Profile short-circuits расширены**: `isAiScaffold` (massive+vibe или scaffold-msg+massive), saturated `vibeFewRaw >= 0.85` (1-2 commits на нетривиальный размер).
- **Вердикты переименованы** в нейтральные: "AI-документация" вместо "AI README, код человека".
- **Валидация на реальных репо** через GitHub API: добавлены тесты на django-rusdoc, gha-version-check, boson-php, moonshine, 3D-Kino — все классифицируются корректно.

## Установка

1. `git clone …` или скачать архив.
2. Chrome → `chrome://extensions/` → включить **Developer mode**.
3. **Load unpacked** → выбрать папку проекта.
4. Открыть любую страницу `github.com/owner/repo` — внизу справа появится бейдж.
5. (Опционально) В popup расширения вставить GitHub PAT — анонимный лимит 60 req/h превратится в 5000.

## Архитектура

```
manifest.json           Manifest V3, host_permissions: api.github.com
src/
├── content/
│   ├── content.js      Парсит URL, инжектит бейдж, реагирует на pjax
│   └── badge.css       Стили бейджа и панели (с dark mode)
├── background/
│   └── service-worker.js   Принимает ANALYZE_REPO, кэширует в session storage
├── lib/
│   ├── github-api.js   Тонкая обёртка над GitHub REST + PAT support
│   ├── scorer.js       Агрегатор: правила → categories → overall
│   └── rules/
│       ├── readme-rules.js   slop-сигналы в README
│       ├── commit-rules.js   forensics по коммитам
│       ├── meta-rules.js     стars/issues/PRs/description
│       └── file-rules.js     surface-файлы (.github, tests, ratio)
└── popup/
    └── popup.html/js/css     Настройка PAT
```

### Поток данных

1. Content script видит `https://github.com/owner/repo` → шлёт `ANALYZE_REPO` в SW.
2. SW смотрит `chrome.storage.session` (TTL 1ч). Хит → возвращает мгновенно.
3. Промах → параллельно тянет `GET /repos`, `/readme`, `/commits?per_page=30`, `/pulls`, `/contents`. Доп. запрос — `commits/{sha}` для stats первого коммита.
4. Собирает контекст, прогоняет через 4 категории правил, агрегирует.
5. Результат отправляется обратно, бейдж обновляется.

### Profile-классификация

Числовой `overall` 0–100 — это только часть ответа. Реальный ground truth, который интересует пользователя, — «кто писал код». README может быть AI-сгенерирован, а код — рукописным, и наоборот. Поэтому помимо числа scorer выдаёт **profile**:

| Profile | Условие | Вердикт |
|---------|---------|---------|
| `ai_full` | (trailers ≥30% или polished SDK или commits≥60) + README/files≥50 | "AI код + AI документация" 🤖 |
| `ai_code` | (trailers ≥30% или polished SDK или commits≥60) | "AI код" 🤖 |
| `ai_docs_only` | README≥55 и нет сильных commit-сигналов | "AI-документация" 📝 |
| `ai_polish_only` | README≥40 + files≥50 и нет сильных commit-сигналов | "AI-полировка README" ✨ |
| `null` | ничего из перечисленного | вердикт по числу overall |

«Сильный commit-сигнал» = `ai_commit_trailers ≥0.7` OR `vibe_coded_few_commits ≥0.7` OR `ai_committer ≥0.5` OR `massive_initial_commit ≥0.7` OR `polished_oneshot_sdk ≥0.85`. Слабые сигналы вроде `conventional_commits_perfection` сознательно исключены — они часто срабатывают на честных human-репо.

Scaffold-маркер (`🤖 Generated with Claude Code`) в **самом старом коммите** ≡ `ai_commit_trailers raw ≥0.85` — это значит проект бутстрапнут AI-агентом с нуля, даже если потом дописывал человек.

Профильные вердикты приоритетнее числовых, и overall подгоняется под профиль (не меньше 60 для `ai_code`, не больше 45 для `ai_docs_only`) — чтобы цвет бейджа и число не противоречили.

### Как устроены правила

Каждое правило — самодостаточный объект:

```js
{
  id: 'emoji_headers',
  weight: 1.0,
  description: 'Эмодзи-заголовки паттерном `## 🚀 Getting Started`',
  score(ctx) { return /* [0..1] */ },
  reason(ctx) { return /* строка для UI */ },
}
```

Добавить новое правило = дописать объект в массив одного из `rules/*.js`. Никакой регистрации.

## Список текущих эвристик

### README (11 правил)
- `emoji_headers` — эмодзи в начале заголовков (≥5)
- `ai_phrase_density` — словарь LLM-фраз (EN/RU)
- `em_dash_density` — плотность em-dash (`—`)
- `perfect_structure` — Installation+Usage+Features+Contributing+License+API (терпит emoji-префиксы)
- `has_perfect_toc` — развёрнутый TOC с anchor-ссылками
- `feature_checkmark_table` — таблицы фич с ✅/❌
- `hyperbolic_opening` — «revolutionary», «blazingly fast», «production-ready»
- `multi_language_readme` ⭐ — 5+ переводов README.{xx}.md (signature AI move)
- `excessive_badges` — 6+ shields.io badges в шапке
- `excessive_collapsibles` — 5+ `<details><summary>` блоков
- `ascii_tree_in_readme` — ASCII project-tree, особенно с emoji-иконками

### Commits (7 правил)
- `ai_commit_trailers` ⭐ — **Co-Authored-By: Claude / Cursor / Devin** и `🤖 Generated with` в теле коммитов. Самый сильный сигнал. Scaffold-маркер в самом старом коммите → AI бутстрапнул проект.
- `vibe_coded_few_commits` — 1-5 коммитов на проект с заметным объёмом кода. Учитывает age-decay и **squash-merge counter-signal**: если PRs ≥20 при commits ≤10, сигнал гасится ×0.25 (это нормальный workflow, не vibe).
- `ai_committer` — `commit.author/committer` совпадает с **AI-агентом**: github-copilot[bot], cursor-bot, claude (только с anthropic email!). **CI-боты исключены явно** (github-actions, dependabot, renovate, mergify, pre-commit-ci, codecov, snyk, semantic-release-bot и др.) — это автоматика, не AI.
- `commit_burst` — ≥5 коммитов за <24h
- `single_author` — один автор + молодой репо + размер
- `conventional_commits_perfection` — 100% conventional-commits = подозрительно (но слабый сигнал, на профиль не влияет)
- `massive_initial_commit` — >2000 строк в первом коммите

### Meta (3 правила)
- `no_social_activity` — звёзды есть, issues и PRs — ноль
- `orphan_repo` — нет внятного `description` (homepage и topics убраны — часто отсутствуют у легитимных репо)
- `description_marketing_speak` — маркетинговые эпитеты в описании

### Files (5 правил)
- `over_engineered_skeleton` — Преждевременный devops/tooling-обвес: dependabot, husky, pre-commit, security policies. **Жёсткий age-decay**: репо старше 3 лет → сигнал ×0.1, старше года → ×0.35. Универсальные файлы (`.editorconfig`, `.gitignore`, базовый `tsconfig.json`) **исключены** — их копипастят все.
- `tests_created_with_code` — `tests/` появилась сразу
- `doc_to_code_ratio` — README больше, чем код
- `dist_committed` ⭐ — `dist/` или `build/` закоммичены вместе с `src/` и `package.json` (типичный AI npm-package паттерн)
- `polished_oneshot_sdk` ⭐ — package manifest + LICENSE + tooling (tsconfig/prettier) + ≤8 коммитов + 1 автор

## Что детектор НЕ ловит

Эвристика работает на **следах**, которые AI-агенты оставляют по умолчанию. Современные кодовые агенты этих следов всё чаще не оставляют, особенно если им явно сказать «не вставляй Co-Authored-By». Конкретно детектор бессилен против:

- **Агента, которому отключили trailers.** `git config user.name "real human"` + промпт «не добавляй Co-Authored-By» — и сильнейший сигнал исчезает.
- **Pretty-prompted кода.** Если человек просит «пиши как обычный senior без всяких "comprehensive" и "leverage"» — словарь LLM-фраз промахнётся.
- **Squash-merge AI-веток.** Если команда squash'ит ветки с AI-коммитами в один без сохранения trailer'ов — следов нет (но `polished_oneshot_sdk` и форма репо могут сработать).
- **AI, которое пишет в живой репо.** Зрелый проект, где AI начали использовать недавно, выглядит как human — старые коммиты задают тон, последние 20-30 коммитов с trailers могут не попасть в выборку.
- **Code stylometry.** Анализа AST/стиля кода нет — слишком тяжело для browser extension. AI-сгенерированный Python, выглядящий как обычный Python, не отловится.

Профильные ярлыки — это **гипотеза**, не доказательство. Цифра 60+ значит «есть основания подозревать», а не «гарантированно AI». False positives (особенно на старых template-based репо) и false negatives (на чистом agent-output без trailers) — известные ограничения.

## Каркас статьи на Хабр

**Заголовок-кандидаты:**
- «Можно ли поймать вайб-кодера без нейросети? Сделал расширение — рассказываю»
- «Археология AI-репозиториев: 18 эвристик без единого LLM»
- «Детектим AI-репо в браузере, потому что детекторы AI на AI — это уже моветон»

**Структура:**
1. **Вступление.** Контекст 2026: GitHub завален vibe-coded slop, существующие детекторы — закрытые SaaS или используют те же LLM. Тезис: можно ли *чисто эвристически*?
2. **Прямые конкуренты и почему не подошли.** isvibecoded.com, ai-gen-code-search, git-ai-project. У всех минусы: либо закрытый сервис, либо требуют запуска вручную, либо доверяют ML-моделям.
3. **Чем сигналить?** Разбор четырёх категорий с примерами правил и почему конкретно они работают/не работают.
4. **Архитектура в браузере.** Manifest V3, content script ↔ service worker ↔ GitHub API. Подводный камень: rate limit без PAT — 60/h, как с ним жить через session cache.
5. **Самое интересное: что выпало в продакшене.** Прогон на 50–100 репо (часть заведомо AI, часть заведомо human). Метрики, false positives, что они нам говорят. Скриншоты бейджа на конкретных репо (анонимизированно, если кого-то заденет).
6. **Что не сработало.** Idea graveyard: пытался ловить через стилометрию кода — слишком зависит от языка; ловить через linter conformance — слишком хорошие люди тоже линтят; ловить через `console.log` плотность.
7. **Расширение → public API → AI agents.** Развилка из обсуждения с Claude: пока это локальная игрушка, но открытый dataset с скорами по trending repos может органически попадать в выдачу Google и быть полезен AI-агентам с web search. Открытый вопрос аудитории: стоит ли этим заниматься.
8. **MIT, ссылка на репо, призыв форкать и добавлять правила.**

**Точки для скриншотов в статью:**
- Бейдж с разным цветом на 3 репо (зелёный/жёлтый/красный)
- Раскрытая панель с breakdown
- Топ-15 false positives с разбором «почему сработало»

## Roadmap (если зайдёт)

- `v0.2`: правила по `package.json`/`requirements.txt` (типичные LLM-выборки версий)
- `v0.2`: учитывать AI-related topics на репо как ground truth для тюнинга весов
- `v0.3`: экспорт результата в JSON, чтобы публиковать как dataset
- `v0.4`: option «отправлять анонимные результаты в публичный pool» — это уже шаг к idea про доступность для AI агентов

## Валидация

Smoke-тест на синтетических контекстах, эмулирующих собранные руками кейсы (большинство — из обсуждения статьи). Запуск: `node test-smoke.mjs`. Покрытие:

| Кейс | Ground truth | Ожидаемый profile |
|------|--------------|---------------------|
| opendataloader-pdf (60% Co-Authored-By: Claude) | AI | `ai_code` или `ai_full` |
| Timetable-bot (README AI-шный, код рукописный) | human | `ai_docs_only` или `null` |
| figma/mcp-server-guide (20% trailers, активный проект) | human | `null` |
| Vibe-coded синтетика (2 коммита, AI README, devops-обвес) | AI | `ai_full` или `ai_code` |
| YTSage-style (активный код, polished AI README с 14 переводами) | mixed | `ai_docs_only` |
| synapsea-auth-react-style (TS SDK, 5 коммитов, dist+src) | AI | `ai_code` или `ai_full` |
| django-rest-framework-rusdoc (9 лет, 98% руками, github-actions[bot]) | human | `null` |
| github-actions-version-check (scaffold marker в initial commit) | AI | `ai_code` или `ai_full` |
| boson-php/boson (полностью руками) | human | `null` |
| moonshine (AI пишет ~40% задач) | AI | `ai_code` или `ai_full` |
| squash-merge workflow (3 коммита + 142 PRs) | human | `null` |

## Лицензия

MIT.
