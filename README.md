# AI Repo Detector

Chrome-расширение, которое **без использования ИИ** оценивает, насколько GitHub-репозиторий выглядит сгенерированным ИИ.

Не выдаёт бинарный вердикт «AI / не AI». Считает четыре независимых субскора (README, Commits, Meta, Files) и общий confidence 0–100. На странице репо висит бейдж, клик — раскрывается панель с разбором каждого сработавшего правила.

> ⚠ Это эвристический детектор. У него будут false positives. Это не баг — это часть проекта.

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

Числовой `overall` 0–100 — это только часть ответа. Реальный ground truth, который интересует пользователя, — «кто писал код». README может быть AI, а код — рукописным, и наоборот. Поэтому помимо числа scorer выдаёт **profile**:

| Profile | Условие | Вердикт |
|---------|---------|---------|
| `ai_full` | (trailers ≥50% или polished SDK или commits≥60) + README/files≥50 | "AI код + AI доки" 🤖 |
| `ai_code` | (trailers ≥50% или polished SDK или commits≥60) | "AI код" 🤖 |
| `ai_docs_only` | README≥55 и нет сильных commit-сигналов | "AI README, код человека" 📝 |
| `ai_polish_only` | README≥40 + files≥50 и нет сильных commit-сигналов | "AI-полировка, код человека" ✨ |
| `null` | ничего из перечисленного | вердикт по числу overall |

«Сильный commit-сигнал» = `ai_commit_trailers ≥0.7` OR `vibe_coded_few_commits ≥0.7` OR `ai_committer ≥0.5` OR `massive_initial_commit ≥0.7` OR `polished_oneshot_sdk ≥0.85`. Слабые сигналы вроде `conventional_commits_perfection` сознательно исключены — они часто срабатывают на честных human-репо.

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
- `ai_commit_trailers` ⭐ — **Co-Authored-By: Claude / Cursor / Devin** и подобные следы в теле коммитов. Самый сильный сигнал в проекте — практически детерминирует AI-авторство при пропорции >50%.
- `vibe_coded_few_commits` — 1-5 коммитов на проект с заметным объёмом кода (с tier'ами для разных размеров)
- `ai_committer` — `commit.author` / `commit.committer` совпадает с `claude`, `cursor`, `aider`, `[bot]`, …
- `commit_burst` — ≥5 коммитов за <24h
- `single_author` — один автор + молодой репо + размер
- `conventional_commits_perfection` — 100% conventional-commits = подозрительно
- `massive_initial_commit` — >2000 строк в первом коммите

### Meta (3 правила)
- `no_social_activity` — звёзды есть, issues и PRs — ноль
- `orphan_repo` — нет description/topics/homepage
- `description_marketing_speak` — маркетинговые эпитеты в описании

### Files (5 правил)
- `over_engineered_skeleton` — CODE_OF_CONDUCT + SECURITY + dependabot у репо <14 дней
- `tests_created_with_code` — `tests/` появилась сразу
- `doc_to_code_ratio` — README больше, чем код
- `dist_committed` ⭐ — `dist/` или `build/` закоммичены вместе с `src/` и `package.json` (типичный AI npm-package паттерн)
- `polished_oneshot_sdk` ⭐ — package manifest + LICENSE + tooling (tsconfig/prettier) + ≤8 коммитов + 1 автор

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

Smoke-тест на синтетических контекстах, эмулирующих собранные руками кейсы. Запуск: `node test-smoke.mjs`. Покрытие:

| Кейс | Ground truth | Ожидаемый profile |
|------|--------------|---------------------|
| opendataloader-pdf (60% Co-Authored-By: Claude) | AI | `ai_code` или `ai_full` |
| Timetable-bot (README AI-шный, код рукописный) | human | `ai_docs_only` или `null` |
| figma/mcp-server-guide (20% trailers, активный проект) | human | `null` |
| Vibe-coded синтетика (2 коммита, AI README, devops-обвес) | AI | `ai_full` или `ai_code` |
| YTSage-style (активный код, polished AI README с 14 переводами) | mixed | `ai_docs_only` |
| synapsea-auth-react-style (TS SDK, 5 коммитов, dist+src) | AI | `ai_code` или `ai_full` |

## Лицензия

MIT.
