// src/lib/rules/commit-rules.js
//
// Forensics по истории коммитов. Анализируем cadence, авторов, размер initial commit.

const AI_COMMITTER_PATTERNS = [
  /^claude/i,
  /^cursor/i,
  /^aider/i,
  /^devin/i,
  /^codex/i,
  /\[bot\]$/,
  /github-copilot/i,
  /openhands/i,
];

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
  for (const c of commits) {
    const msg = c.commit?.message || '';
    if (!AI_TRAILER_PATTERNS.some(re => re.test(msg))) continue;
    hits++;
    // достаём имя из Co-Authored-By: NAME <email>
    const m = msg.match(/co-?authored-?by:\s*([^<\n]+?)\s*</i);
    if (m) {
      names.add(m[1].trim());
    } else if (/🤖\s*generated\s+with/i.test(msg) || /generated\s+with\s+\[?claude\s+code/i.test(msg)) {
      names.add('Claude Code marker');
    } else if (/\bcursor:\s*(generated|edited)\b/i.test(msg)) {
      names.add('Cursor signature');
    }
  }
  return { hits, names };
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
      const { hits } = extractAiTrailerInfo(commits);
      ctx._aiTrailerHits = hits;
      const ratio = hits / commits.length;
      // >50% — агент пишет код, по факту "AI авторство"
      // 30-50% — агент-ассистент пишет половину
      // 15-30% — лёгкая агент-помощь (figma/mcp-server-guide ≈ 20%)
      // <15% — единичные касания (норма для современных команд)
      if (ratio >= 0.5) return 1;
      if (ratio >= 0.3) return 0.7;
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
    weight: 2.0,  // сильный сигнал, когда нет trailers (squashed history, ручной перенос кода и т.п.)
    description: '1-3 коммита на проект с заметным объёмом кода',
    score(ctx) {
      const commits = ctx.commits || [];
      const sizeKB = ctx.repo?.size || 0;
      const ageDays = ctx.repoAgeDays;
      const commitCount = ctx.totalCommits ?? commits.length;

      if (commitCount === 0) return 0;

      // AI vibe-coding обычно свежее. Старый репо с 1 коммитом — чаще
      // forked-копия, archive, или просто заброшенный legit-репо.
      let ageFactor = 1.0;
      if (ageDays > 180) ageFactor = 0.45;
      else if (ageDays > 120) ageFactor = 0.65;
      else if (ageDays > 60) ageFactor = 0.85;

      let base = 0;
      if (commitCount <= 2 && sizeKB > 20) base = 1.0;
      else if (commitCount <= 3 && sizeKB > 50) base = 0.9;
      else if (commitCount <= 5 && sizeKB > 100) base = 0.7;
      else if (commitCount <= 5 && sizeKB > 30)  base = 0.55;  // SDK / небольшая утилита
      else if (commitCount <= 8 && sizeKB > 80)  base = 0.45;
      else if (commitCount <= 2 && ageDays > 30 && sizeKB > 10) base = 0.85;

      return base * ageFactor;
    },
    reason: (ctx) => {
      const n = ctx.totalCommits ?? (ctx.commits || []).length;
      const ageDays = ctx.repoAgeDays;
      const decay = ageDays > 180 ? ' (затухание ×0.45 из-за возраста)' :
                    ageDays > 120 ? ' (затухание ×0.65)' :
                    ageDays > 60  ? ' (затухание ×0.85)' : '';
      return `${n} коммит(ов) на ${ctx.repo?.size || 0}KB, возраст ${ageDays}д${decay}`;
    },
  },

  {
    id: 'ai_committer',
    weight: 1.8,  // когда сам commit.author = бот (squash-мерж от автоматики, force-push от агента)
    description: 'Имя коммиттера выдаёт AI-инструмент',
    score(ctx) {
      const commits = ctx.commits || [];
      if (!commits.length) return 0;
      const aiCommits = commits.filter(c => {
        const name = c.commit?.author?.name || c.commit?.committer?.name || '';
        return AI_COMMITTER_PATTERNS.some(re => re.test(name));
      });
      return Math.min(1, aiCommits.length / commits.length);
    },
    reason: (ctx) => {
      const commits = ctx.commits || [];
      const aiAuthors = new Set();
      for (const c of commits) {
        const name = c.commit?.author?.name || c.commit?.committer?.name || '';
        if (AI_COMMITTER_PATTERNS.some(re => re.test(name))) aiAuthors.add(name);
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
    weight: 0.8,
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
];
