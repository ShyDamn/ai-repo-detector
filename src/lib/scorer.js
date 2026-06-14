// src/lib/scorer.js
//
// Агрегатор. Ключевые отличия от наивного weighted average:
//   1. Каждая категория: 60% weighted-avg + 40% max single signal.
//      Сильный одиночный сигнал тащит категорию вверх, а не тонет в нулях.
//   2. Overall: 70% weighted-avg по категориям + 30% максимум среди категорий.
//   3. Cross-category boost: если ≥2 категории показали ≥50, +12 к overall —
//      но только если коммиты тоже подозрительны. Иначе бустить нельзя:
//      «AI README + AI tooling, но код человеческий» — это не AI-репо.
//   4. Profile: явная классификация AI_CODE / AI_DOCS_ONLY / AI_FULL,
//      чтобы вердикт отражал реальность («AI README, код человека»),
//      а не только число.

import { readmeRules } from './rules/readme-rules.js';
import { commitRules } from './rules/commit-rules.js';
import { metaRules } from './rules/meta-rules.js';
import { fileRules } from './rules/file-rules.js';

const CATEGORIES = {
  readme: readmeRules,
  commits: commitRules,
  meta: metaRules,
  files: fileRules,
};

const CATEGORY_WEIGHTS = {
  readme: 1.0,
  commits: 1.4,
  meta: 0.6,
  files: 0.8,
};

function scoreCategory(rules, ctx) {
  const details = [];
  let weightedSum = 0;
  let totalWeight = 0;
  let maxRaw = 0;

  for (const rule of rules) {
    let raw = 0;
    try {
      raw = rule.score(ctx) || 0;
    } catch {
      raw = 0;
    }
    weightedSum += raw * rule.weight;
    totalWeight += rule.weight;
    if (raw > maxRaw) maxRaw = raw;
    if (raw > 0.05) {
      details.push({
        id: rule.id,
        description: rule.description,
        raw,
        weight: rule.weight,
        contribution: raw * rule.weight,
        reason: typeof rule.reason === 'function' ? rule.reason(ctx) : rule.reason,
      });
    }
  }

  const avg = totalWeight ? weightedSum / totalWeight : 0;
  const score = Math.min(1, 0.6 * avg + 0.4 * maxRaw) * 100;
  return {
    score: Math.round(score),
    details: details.sort((a, b) => b.contribution - a.contribution),
  };
}

// Профиль = что именно AI-шное в репо. Это не альтернатива overall-score,
// а отдельный измерительный срез: ground truth у пользователя — «кто писал
// код», а не «насколько похоже на AI».
//
// Сначала идут deterministic short-circuit'ы, основанные на конкретных
// сильных правилах. Category-aggregate score размывается слабыми/нулевыми
// правилами, поэтому "сильно сработавшее одно правило" может утонуть, и
// профильный вердикт обязан опираться на raw сигналы.
function classifyProfile(cs, results, ctx) {
  const c = cs.commits;
  const r = cs.readme;
  const f = cs.files;
  const findRaw = (cat, id) => results[cat]?.details.find(d => d.id === id)?.raw || 0;

  // Какие правила считаем «сильным сигналом AI-авторства кода»
  const trailerRaw    = findRaw('commits', 'ai_commit_trailers');
  const vibeFewRaw    = findRaw('commits', 'vibe_coded_few_commits');
  const committerRaw  = findRaw('commits', 'ai_committer');
  const massiveRaw    = findRaw('commits', 'massive_initial_commit');
  const scaffoldMsg   = findRaw('commits', 'scaffold_initial_message');
  const polishedSdk   = findRaw('files',   'polished_oneshot_sdk');

  // Snapshot detection: README имеет `git clone https://github.com/<OWNER>/...`
  // где <OWNER> отличается от текущего владельца репо. Это значит репо —
  // импорт/snapshot чужого проекта. form-based сигналы (polished_sdk,
  // vibe_few_commits) описывают чужой труд, а не AI-генерацию текущего юзера.
  const ownerLogin = (ctx.repo?.owner?.login || '').toLowerCase();
  const snapMatch = (ctx.readme || '').match(
    /git\s+clone\s+(?:https?:\/\/|git@)github\.com[\/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[\s\/]|$)/i
  );
  const isSnapshotOfOther = !!(snapMatch && ownerLogin && snapMatch[1].toLowerCase() !== ownerLogin);
  if (isSnapshotOfOther) {
    ctx._snapshotFrom = `${snapMatch[1]}/${snapMatch[2]}`;
  }

  // Direct signals говорят что AI ТРОГАЛ коммиты текущего юзера.
  // Indirect signals говорят что репо "выглядит как одношотовая генерация" —
  // но snapshot чужого проекта выглядит так же. В snapshot-режиме indirect не доверяем.
  const strongDirectSignal =
    trailerRaw    >= 0.7 ||
    committerRaw  >= 0.5 ||
    massiveRaw    >= 0.7 ||
    scaffoldMsg   >= 0.75;

  const strongIndirectSignal =
    vibeFewRaw    >= 0.7 ||
    polishedSdk   >= 0.85;

  const strongCommitSignal = strongDirectSignal ||
    (strongIndirectSignal && !isSnapshotOfOther);

  // Direct AI evidence — следы AI в коммитах/initial-сообщении. Эти сигналы
  // не зависят от того, чей это код — они говорят что AI ПИСАЛ что-то конкретно
  // в этом аккаунте.
  const isAiScaffold =
    (scaffoldMsg >= 0.75 && massiveRaw >= 0.4) ||
    (massiveRaw >= 0.7 && vibeFewRaw >= 0.3);
  const directAiSignal = trailerRaw >= 0.7 || isAiScaffold;

  // Indirect AI — форма репо: SDK-обвес, 1 коммит на много кода.
  // Эти сигналы выглядят одинаково для AI-vibe-кода и snapshot'а чужого проекта.
  // В snapshot-случае не доверяем — пусть README решает.
  const indirectAiSignal = polishedSdk >= 0.85 || vibeFewRaw >= 0.85;

  // Direct signal — всегда триггерит. Indirect — только если не snapshot.
  if (directAiSignal || (indirectAiSignal && !isSnapshotOfOther)) {
    if (r >= 50 || f >= 50) return 'ai_full';
    return 'ai_code';
  }

  // AI код через category-aggregate. Тоже подавляем при snapshot.
  if (c >= 60 && !isSnapshotOfOther) {
    if (r >= 50 || f >= 50) return 'ai_full';
    return 'ai_code';
  }

  // README кричит AI, но НИ ОДНОГО сильного commit-сигнала → код человеческий.
  if (r >= 55 && !strongCommitSignal) return 'ai_docs_only';

  // README средне-подозрительный + tooling AI-шный. В snapshot-кейсе files-сигнал
  // может быть формой чужого проекта, но это всё равно валидно — пользователь
  // добавил AI README поверх чужого/своего кода.
  if (r >= 40 && f >= 50 && !strongCommitSignal) return 'ai_polish_only';
  // Также fallback для snapshot, у которого rome>=40 но f<50
  if (isSnapshotOfOther && r >= 40 && !strongCommitSignal) return 'ai_polish_only';
  return null;
}

export function analyze(ctx) {
  const categoryResults = {};
  const catScores = {};

  for (const [name, rules] of Object.entries(CATEGORIES)) {
    const result = scoreCategory(rules, ctx);
    categoryResults[name] = result;
    catScores[name] = result.score;
  }

  let weightedTotal = 0;
  let totalCategoryWeight = 0;
  let maxCat = 0;
  for (const [name, score] of Object.entries(catScores)) {
    weightedTotal += score * CATEGORY_WEIGHTS[name];
    totalCategoryWeight += CATEGORY_WEIGHTS[name];
    if (score > maxCat) maxCat = score;
  }
  const avgOverall = weightedTotal / totalCategoryWeight;
  let overall = Math.round(0.7 * avgOverall + 0.3 * maxCat);

  // Boost: ≥2 категории подсвечены AND коммиты тоже подсвечены.
  // Без последнего условия мы вытягиваем «AI doc / human code» в красную
  // зону — это и был баг с Timetable-bot.
  const strongCats = Object.values(catScores).filter(s => s >= 50).length;
  if (strongCats >= 2 && catScores.commits >= 35) {
    overall = Math.min(100, overall + 12);
  }

  const profile = classifyProfile(catScores, categoryResults, ctx);

  // Подтягиваем overall к профилю, чтобы цвет бейджа и число не противоречили.
  // Если профиль — AI код, overall не ниже 60 (порог "Скорее всего AI").
  if (profile === 'ai_full')         overall = Math.max(overall, 70);
  if (profile === 'ai_code')         overall = Math.max(overall, 60);
  // Если код почти точно человеческий — режем overall.
  if (profile === 'ai_docs_only')   overall = Math.min(overall, 45);
  if (profile === 'ai_polish_only') overall = Math.min(overall, 40);

  // Контекстные заметки для UI (snapshot, squash-merge и т.п.) — то, что
  // не правило, но влияет на классификацию и должно быть видно пользователю.
  const notes = [];
  if (ctx._snapshotFrom) {
    notes.push(`📦 README указывает на git clone из github.com/${ctx._snapshotFrom} — этот репо похож на snapshot/импорт чужого проекта. Сигналы формы (polished SDK, vibe-coded few commits) подавлены.`);
  }

  return {
    overall,
    verdict: verdictFor(overall, profile),
    profile,
    categories: categoryResults,
    strongCategories: strongCats,
    notes,
    meta: {
      analyzedAt: Date.now(),
      repoAgeDays: ctx.repoAgeDays,
      commitsAnalyzed: (ctx.commits || []).length,
      totalCommits: ctx.totalCommits,
      readmeChars: ctx.readme?.length || 0,
    },
  };
}

function verdictFor(score, profile) {
  // Profile-вердикты приоритетнее числовых: они описывают что именно нашли
  if (profile === 'ai_full')         return { label: 'AI код + AI документация',  color: '#b31d28', emoji: '🤖' };
  if (profile === 'ai_code')         return { label: 'AI код',                    color: '#d73a49', emoji: '🤖' };
  if (profile === 'ai_docs_only')    return { label: 'AI-документация',           color: '#dbab09', emoji: '📝' };
  if (profile === 'ai_polish_only')  return { label: 'AI-полировка README',       color: '#dbab09', emoji: '✨' };

  if (score >= 70) return { label: 'Почти точно AI',  color: '#d73a49', emoji: '🤖' };
  if (score >= 55) return { label: 'Скорее всего AI', color: '#e36209', emoji: '🤔' };
  if (score >= 35) return { label: 'AI-следы',        color: '#dbab09', emoji: '⚖️' };
  return            { label: 'Похоже на human',       color: '#28a745', emoji: '👤' };
}
