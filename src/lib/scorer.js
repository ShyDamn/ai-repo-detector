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
function classifyProfile(cs, results) {
  const c = cs.commits;
  const r = cs.readme;
  const f = cs.files;
  const findRaw = (cat, id) => results[cat]?.details.find(d => d.id === id)?.raw || 0;

  // Какие правила считаем «сильным сигналом AI-авторства кода»
  const trailerRaw    = findRaw('commits', 'ai_commit_trailers');
  const vibeFewRaw    = findRaw('commits', 'vibe_coded_few_commits');
  const committerRaw  = findRaw('commits', 'ai_committer');
  const massiveRaw    = findRaw('commits', 'massive_initial_commit');
  const polishedSdk   = findRaw('files',   'polished_oneshot_sdk');

  const strongCommitSignal =
    trailerRaw   >= 0.7 ||
    vibeFewRaw   >= 0.7 ||
    committerRaw >= 0.5 ||
    massiveRaw   >= 0.7 ||
    polishedSdk  >= 0.85;

  // Deterминированный путь: >=50% коммитов с AI-trailers или polished-oneshot SDK
  // — практически доказательство, что код пишет агент.
  if (trailerRaw >= 1.0 || polishedSdk >= 0.85) {
    if (r >= 50 || f >= 50) return 'ai_full';
    return 'ai_code';
  }

  // AI код подтверждён через category-aggregate
  if (c >= 60) {
    if (r >= 50 || f >= 50) return 'ai_full';
    return 'ai_code';
  }

  // README кричит AI, но НИ ОДНОГО сильного commit-сигнала → код человеческий.
  // Слабые сигналы вроде conventional_commits_perfection не дисквалифицируют
  // этот профиль: они часто срабатывают и на чисто человеческих проектах.
  if (r >= 55 && !strongCommitSignal) return 'ai_docs_only';

  // README средне-подозрительный + tooling AI-шный, но без сильных commit-сигналов
  if (r >= 40 && f >= 50 && !strongCommitSignal) return 'ai_polish_only';
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

  const profile = classifyProfile(catScores, categoryResults);

  // Подтягиваем overall к профилю, чтобы цвет бейджа и число не противоречили.
  // Если профиль — AI код, overall не ниже 60 (порог "Скорее всего AI").
  if (profile === 'ai_full')         overall = Math.max(overall, 70);
  if (profile === 'ai_code')         overall = Math.max(overall, 60);
  // Если код почти точно человеческий — режем overall.
  if (profile === 'ai_docs_only')   overall = Math.min(overall, 45);
  if (profile === 'ai_polish_only') overall = Math.min(overall, 40);

  return {
    overall,
    verdict: verdictFor(overall, profile),
    profile,
    categories: categoryResults,
    strongCategories: strongCats,
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
  if (profile === 'ai_full')         return { label: 'AI код + AI доки',          color: '#b31d28', emoji: '🤖' };
  if (profile === 'ai_code')         return { label: 'AI код',                    color: '#d73a49', emoji: '🤖' };
  if (profile === 'ai_docs_only')    return { label: 'AI README, код человека',   color: '#dbab09', emoji: '📝' };
  if (profile === 'ai_polish_only')  return { label: 'AI-полировка, код человека', color: '#dbab09', emoji: '✨' };

  if (score >= 70) return { label: 'Почти точно AI',  color: '#d73a49', emoji: '🤖' };
  if (score >= 55) return { label: 'Скорее всего AI', color: '#e36209', emoji: '🤔' };
  if (score >= 35) return { label: 'AI-следы',        color: '#dbab09', emoji: '⚖️' };
  return            { label: 'Похоже на human',       color: '#28a745', emoji: '👤' };
}
