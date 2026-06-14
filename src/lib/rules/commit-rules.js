// src/lib/rules/commit-rules.js
//
// Forensics по истории коммитов. Анализируем cadence, авторов, размер initial commit.

// Имена, которые подозрительны САМИ ПО СЕБЕ — встречаются только как
// AI-агенты, реальные люди и CI-боты с такими именами не коммитят.
const AI_BOT_NAME_PATTERNS = [
  /^github-copilot(\[bot\])?$/i,
  /^cursor[-_]?bot$/i,
  /^aider(\[bot\])?$/i,
  /^devin(-ai)?(\[bot\])?$/i,
  /^codex(\[bot\])?$/i,
  /^openhands(\[bot\])?$/i,
  /^all-?hands(\[bot\])?$/i,
  /^claude(-code)?(\[bot\])?$/i,  // имя Claude само по себе требует подтверждения email — см. ниже
];

// Имена, которые могут указывать на AI, но также — на реальных людей
// (Claude — реальное имя!) или CI-ботов. Триггерим только если рядом
// AI-специфичный email или явный [bot]-суффикс.
const AI_NAME_NEEDS_EMAIL = [
  { name: /^claude\b/i, mustEmail: /(@anthropic\.com|claude.*@|@claude\.ai)/i },
  { name: /^cursor\b/i, mustEmail: /(@cursor\.(com|sh)|cursor.*@)/i },
];

// CI-боты которые НИКОГДА не должны триггерить ai_committer.
// Имея этот список явно, проще объяснить почему репо human.
const CI_BOT_BLACKLIST = [
  /^github-actions(\[bot\])?$/i,
  /^dependabot(\[bot\])?$/i,
  /^renovate(\[bot\])?$/i,
  /^renovate-bot$/i,
  /^pre-commit-ci(\[bot\])?$/i,
  /^mergify(\[bot\])?$/i,
  /^codecov(\[bot\])?$/i,
  /^stale(\[bot\])?$/i,
  /^semantic-release-bot$/i,
  /^allcontributors(\[bot\])?$/i,
  /^imgbot(\[bot\])?$/i,
  /^snyk-bot$/i,
  /^web-flow$/i,  // GitHub squash-merge bot
];

function isCiBot(name) {
  return CI_BOT_BLACKLIST.some(re => re.test(name));
}

function matchesAiCommitter(name, email) {
  if (!name) return false;
  if (isCiBot(name)) return false;            // CI-боты исключаем ДО любых других проверок
  if (AI_BOT_NAME_PATTERNS.some(re => re.test(name))) {
    // Имя в whitelist'е, но для "Claude" — нужна email-подтверждение
    for (const { name: nre, mustEmail } of AI_NAME_NEEDS_EMAIL) {
      if (nre.test(name)) return mustEmail.test(email || '');
    }
    return true;  // имя из bot-whitelist'а и не требует email-подтверждения
  }
  return false;
}

// AI-агенты оставляют следы в теле коммита. Это самый сильный, почти
// детерминированный сигнал: noreply@anthropic.com, cursor@cursor.com,
// noreply@devin.ai и т.п. появляются только если коммит реально касался
// агента. Co-Authored-By: <human>@users.noreply.github.com сюда не попадёт
// потому что мы матчим конкретные домены/имена.
const AI_TRAILER_PATTERNS = [
  // Co-Authored-By варианты с известными AI-именами/доменами
  /co-?authored-?by:\s*claude\b/i,
  /co-?authored-?by:[^<\n]*<noreply@anthropic\.com>/i,
  /co-?authored-?by:\s*cursor\b/i,
  /co-?authored-?by:[^<\n]*<[^>]*@cursor\.(com|sh)>/i,
  /co-?authored-?by:\s*devin\b/i,
  /co-?authored-?by:[^<\n]*<[^>]*@devin\.ai>/i,
  /co-?authored-?by:\s*openhands\b/i,
  /co-?authored-?by:[^<\n]*<[^>]*@all-hands\.dev>/i,
  /co-?authored-?by:\s*aider\b/i,
  /co-?authored-?by:\s*codex\b/i,
  /co-?authored-?by:\s*github-copilot\b/i,
  /co-?authored-?by:[^<\n]*<[^>]*@copilot\b[^>]*>/i,
  // Branding markers, которые агенты вставляют сами
  /🤖\s*generated\s+with/i,
  /generated\s+with\s+\[?claude\s+code/i,
  /generated-by:\s*(claude|cursor|aider|devin|codex|openhands)/i,
  // Cursor commit signature
  /\bcursor:\s*(generated|edited)\b/i,
];

function extractAiTrailerInfo(commits) {
  const names = new Set();
  let hits = 0;
  let scaffoldHits = 0;  // 🤖 Generated with — отдельный счётчик
  let scaffoldInOldestCommit = false;
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const msg = c.commit?.message || '';
    if (!AI_TRAILER_PATTERNS.some(re => re.test(msg))) continue;
    hits++;
    const isScaffold = /🤖\s*generated\s+with/i.test(msg) || /generated\s+with\s+\[?claude\s+code/i.test(msg);
    if (isScaffold) {
      scaffoldHits++;
      // Если scaffold marker в самом старом из выбранных коммитов (commits[-1] хронологически)
      if (i === commits.length - 1) scaffoldInOldestCommit = true;
    }
    const m = msg.match(/co-?authored-?by:\s*([^<\n]+?)\s*</i);
    if (m) {
      names.add(m[1].trim());
    } else if (isScaffold) {
      names.add('Claude Code marker');
    } else if (/\bcursor:\s*(generated|edited)\b/i.test(msg)) {
      names.add('Cursor signature');
    }
  }
  return { hits, names, scaffoldHits, scaffoldInOldestCommit };
}

const CONVENTIONAL_COMMIT = /^(feat|fix|chore|docs|refactor|test|build|ci|perf|style)(\([^)]+\))?:\s+/;

export const commitRules = [
  {
    id: 'ai_commit_trailers',
    weight: 2.5,  // самый сильный сигнал в проекте: trailers практически детерминированы
    description: 'AI-trailers в теле коммитов: Co-Authored-By: Claude/Cursor/Devin, 🤖 Generated with…',
    score(ctx) {
      const commits = ctx.commits || [];
      if (!commits.length) return 0;
      const { hits, scaffoldHits, scaffoldInOldestCommit } = extractAiTrailerInfo(commits);
      ctx._aiTrailerHits = hits;
      const ratio = hits / commits.length;

      // Scaffold marker (🤖 Generated with Claude Code) В САМОМ СТАРОМ коммите —
      // это значит проект был сгенерирован агентом с нуля. Даже если потом
      // человек дописывал, AI авторство кода зафиксировано.
      if (scaffoldInOldestCommit) return Math.max(0.85, ratio >= 0.5 ? 1 : 0.85);

      // Любой scaffold-marker — сильнее обычного co-author trailer
      if (scaffoldHits > 0 && ratio < 0.3) return Math.max(0.55, ratio);

      // Обычная пропорция Co-Authored-By
      if (ratio >= 0.5) return 1;
      if (ratio >= 0.3) return 0.75;  // подняли с 0.7 — moonshine кейс
      if (ratio >= 0.15) return 0.35;
      if (ratio > 0)    return 0.15;
      return 0;
    },
    reason(ctx) {
      const commits = ctx.commits || [];
      const { hits, names } = extractAiTrailerInfo(commits);
      if (!hits) return '';
      const pct = Math.round((hits / commits.length) * 100);
      const namesArr = [...names].slice(0, 3);
      const more = names.size > 3 ? '…' : '';
      return `${hits}/${commits.length} коммитов (${pct}%) с AI-trailers: ${namesArr.join(', ')}${more}`;
    },
  },

  {
    id: 'vibe_coded_few_commits',
    weight: 2.0,
    description: '1-10 коммитов на проект с заметным объёмом кода (с поправкой на squash-merge и заброшенность)',
    score(ctx) {
      const commits = ctx.commits || [];
      const sizeKB = ctx.repo?.size || 0;
      const ageDays = ctx.repoAgeDays;
      const commitCount = ctx.totalCommits ?? commits.length;
      const prCount = ctx.pullRequestsCount || 0;
      const stars = ctx.repo?.stargazers_count || 0;

      if (commitCount === 0) return 0;

      // Counter-signal: squash-merge команды могут иметь мало коммитов в main,
      // но много PRs. Это НЕ vibe-coding — это нормальный workflow.
      const isSquashMerge = (prCount >= 20 && commitCount <= 10) || (prCount >= commitCount * 5 && commitCount >= 2);

      // "Abandoned vibe": few commits + no PRs + few stars = классический "vibe-coded и забыл".
      // Возраст в этом случае не должен спасать — это и есть AI scaffolding.
      const isAbandonedVibe = commitCount <= 10 && prCount <= 2 && stars < 10;

      let ageFactor = 1.0;
      if (!isAbandonedVibe) {
        if (ageDays > 180) ageFactor = 0.45;
        else if (ageDays > 120) ageFactor = 0.65;
        else if (ageDays > 60) ageFactor = 0.85;
      } else if (ageDays > 3 * 365) {
        // Совсем древний repo даже с признаками vibe — скорее archive
        ageFactor = 0.5;
      }
      // Иначе ageFactor = 1.0 (не давим)

      let base = 0;
      if (commitCount <= 2 && sizeKB > 20) base = 1.0;
      else if (commitCount <= 3 && sizeKB > 50) base = 0.9;
      else if (commitCount <= 5 && sizeKB > 100) base = 0.8;
      else if (commitCount <= 5 && sizeKB > 20)  base = 0.65;  // synapsea-auth-react: 5 commits 27KB
      else if (commitCount <= 7 && sizeKB > 30)  base = 0.55;  // gha-version-check: 6 commits 40KB
      else if (commitCount <= 10 && sizeKB > 50) base = 0.4;
      else if (commitCount <= 2 && ageDays > 30 && sizeKB > 10) base = 0.85;

      let score = base * ageFactor;
      if (isSquashMerge) score *= 0.25;
      return score;
    },
    reason: (ctx) => {
      const n = ctx.totalCommits ?? (ctx.commits || []).length;
      const ageDays = ctx.repoAgeDays;
      const prCount = ctx.pullRequestsCount || 0;
      const stars = ctx.repo?.stargazers_count || 0;
      const isSquashMerge = (prCount >= 20 && n <= 10) || (prCount >= n * 5 && n >= 2);
      const isAbandonedVibe = n <= 10 && prCount <= 2 && stars < 10;
      const parts = [`${n} коммит(ов) на ${ctx.repo?.size || 0}KB, возраст ${ageDays}д`];
      if (isAbandonedVibe) parts.push(`abandoned vibe (PRs:${prCount}, ★${stars}) — age decay снят`);
      else if (ageDays > 180) parts.push('возрастной decay');
      if (isSquashMerge) parts.push(`squash-merge counter (${prCount} PRs)`);
      return parts.join(', ');
    },
  },

  {
    id: 'ai_committer',
    weight: 1.8,
    description: 'commit.author = AI-агент (Copilot, Cursor-bot, Claude с anthropic-email, …) — НЕ ловит CI-ботов',
    score(ctx) {
      const commits = ctx.commits || [];
      if (!commits.length) return 0;
      const aiCommits = commits.filter(c => {
        const name  = c.commit?.author?.name  || c.commit?.committer?.name  || '';
        const email = c.commit?.author?.email || c.commit?.committer?.email || '';
        return matchesAiCommitter(name, email);
      });
      return Math.min(1, aiCommits.length / commits.length);
    },
    reason: (ctx) => {
      const commits = ctx.commits || [];
      const aiAuthors = new Set();
      for (const c of commits) {
        const name  = c.commit?.author?.name  || c.commit?.committer?.name  || '';
        const email = c.commit?.author?.email || c.commit?.committer?.email || '';
        if (matchesAiCommitter(name, email)) aiAuthors.add(name);
      }
      return aiAuthors.size ? `AI-коммиттеры: ${[...aiAuthors].join(', ')}` : '';
    },
  },

  {
    id: 'commit_burst',
    weight: 1.0,
    description: 'Все коммиты в одном коротком окне',
    score(ctx) {
      const commits = ctx.commits || [];
      if (commits.length < 3) return 0;
      const dates = commits
        .map(c => new Date(c.commit?.author?.date).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => a - b);
      if (dates.length < 3) return 0;
      const spanDays = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
      // ≥5 коммитов в окне <24h — burst
      if (spanDays < 1 && dates.length >= 5) return 1;
      if (spanDays < 3 && dates.length >= 10) return 0.8;
      if (spanDays < 7 && dates.length >= 20) return 0.6;
      return 0;
    },
    reason: (ctx) => {
      const commits = ctx.commits || [];
      const dates = commits.map(c => new Date(c.commit?.author?.date).getTime())
        .filter(t => !isNaN(t)).sort((a, b) => a - b);
      if (dates.length < 3) return '';
      const span = ((dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24)).toFixed(1);
      return `${commits.length} коммитов за ${span} дней`;
    },
  },

  {
    id: 'single_author',
    weight: 0.5,
    description: 'Один автор + молодой репо + большой размер',
    score(ctx) {
      const commits = ctx.commits || [];
      if (commits.length < 5) return 0;
      const authors = new Set(commits.map(c => c.commit?.author?.email).filter(Boolean));
      const isSolo = authors.size === 1;
      const sizeKB = ctx.repo?.size || 0;
      // одиночка с молодым (<30 дней) и большим (>500KB) репо
      if (isSolo && ctx.repoAgeDays < 30 && sizeKB > 500) return 1;
      if (isSolo && ctx.repoAgeDays < 60) return 0.4;
      return 0;
    },
    reason: (ctx) => {
      const authors = new Set((ctx.commits || []).map(c => c.commit?.author?.email).filter(Boolean));
      return `${authors.size} автор(ов), возраст ${ctx.repoAgeDays}д, ${ctx.repo?.size || 0}KB`;
    },
  },

  {
    id: 'conventional_commits_perfection',
    weight: 0.7,
    description: 'Идеальный conventional-commits на всех коммитах подряд (LLM делают так всегда)',
    score(ctx) {
      const commits = ctx.commits || [];
      if (commits.length < 5) return 0;
      const messages = commits.map(c => (c.commit?.message || '').split('\n')[0]);
      const conformant = messages.filter(m => CONVENTIONAL_COMMIT.test(m)).length;
      const ratio = conformant / messages.length;
      // 100% conventional + молодой репо = подозрительно
      if (ratio === 1 && commits.length >= 8) return 1;
      if (ratio > 0.9) return 0.7;
      return 0;
    },
    reason: (ctx) => {
      const commits = ctx.commits || [];
      const conformant = commits.filter(c =>
        CONVENTIONAL_COMMIT.test((c.commit?.message || '').split('\n')[0])
      ).length;
      return `${conformant}/${commits.length} коммитов в conventional-формате`;
    },
  },

  {
    id: 'massive_initial_commit',
    weight: 1.0,  // подняли с 0.8: 5000+ строк в первом коммите — почти всегда AI scaffold
    description: 'Огромный initial commit ("feat: initial implementation")',
    score(ctx) {
      const commits = ctx.commits || [];
      if (!commits.length) return 0;
      // Если коммитов мало — это уже учтено в vibe_few_commits, не дублируем
      const total = ctx.totalCommits ?? commits.length;
      if (total <= 3) return 0;
      const first = commits[commits.length - 1];
      const stats = first.stats;
      if (!stats) return 0;
      if (stats.additions > 5000) return 1;
      if (stats.additions > 2000) return 0.7;
      if (stats.additions > 800) return 0.4;
      return 0;
    },
    reason: (ctx) => {
      const commits = ctx.commits || [];
      const first = commits[commits.length - 1];
      const adds = first?.stats?.additions || 0;
      return adds ? `Initial commit: +${adds} строк` : '';
    },
  },

  {
    id: 'scaffold_initial_message',
    weight: 1.4,  // AI-стиль initial-сообщения — очень характерный паттерн
    description: 'Initial commit оформлен как presentational changelog (multi-line + Features bullets)',
    score(ctx) {
      const commits = ctx.commits || [];
      if (commits.length === 0) return 0;
      // Берём самый старый из выбранных коммитов
      const oldest = commits[commits.length - 1];
      const msg = oldest.commit?.message || '';
      const lines = msg.split('\n');
      if (lines.length < 3) return 0;

      // Признаки AI-структуры:
      // 1. Первая строка содержит описательный заголовок (>20 символов), не "Initial commit"
      // 2. После пустой строки идёт раздел "Features:" / "Highlights:" / "Capabilities:"
      // 3. ИЛИ bullet-список с "- " / "* " в 3+ строках подряд
      const firstLine = lines[0];
      const hasDescriptiveTitle = firstLine.length > 25 &&
        !/^(initial|init|first|wip|test|setup|start)\s*(commit)?$/i.test(firstLine.trim());

      const hasFeaturesSection = /^\s*(features?|highlights?|capabilities|includes|what'?s included|overview)\s*:?\s*$/im.test(msg);

      // Подсчёт consecutive bullet-lines
      let maxBulletRun = 0, currentRun = 0;
      for (const l of lines) {
        if (/^\s*[-*]\s+\w/.test(l)) {
          currentRun++;
          maxBulletRun = Math.max(maxBulletRun, currentRun);
        } else if (l.trim() === '') {
          // пустая не сбрасывает строго, но и не накапливает
        } else {
          currentRun = 0;
        }
      }
      const hasBulletList = maxBulletRun >= 3;

      let score = 0;
      if (hasDescriptiveTitle && hasFeaturesSection && hasBulletList) score = 1.0;
      else if (hasDescriptiveTitle && hasBulletList) score = 0.75;
      else if (hasFeaturesSection && hasBulletList) score = 0.65;
      else if (hasDescriptiveTitle && lines.length >= 5) score = 0.3;
      return score;
    },
    reason(ctx) {
      const commits = ctx.commits || [];
      if (!commits.length) return '';
      const oldest = commits[commits.length - 1];
      const msg = oldest.commit?.message || '';
      const lines = msg.split('\n');
      if (lines.length < 3) return '';
      const firstLine = lines[0].slice(0, 60);
      const hasFeatures = /^\s*(features?|highlights?|capabilities)\s*:?\s*$/im.test(msg);
      const bullets = lines.filter(l => /^\s*[-*]\s+\w/.test(l)).length;
      const tags = [];
      if (hasFeatures) tags.push('"Features:" section');
      if (bullets >= 3) tags.push(`${bullets} bullets`);
      return tags.length ? `Initial: "${firstLine}…" — ${tags.join(', ')}` : '';
    },
  },
];
