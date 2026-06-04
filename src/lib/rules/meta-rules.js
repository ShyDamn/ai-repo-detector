// src/lib/rules/meta-rules.js
//
// Метаданные репо: социальные сигналы и активность.

export const metaRules = [
  {
    id: 'no_social_activity',
    weight: 0.6,
    description: 'Нет issues, нет PRs, нет вовлечения',
    score(ctx) {
      const repo = ctx.repo;
      if (!repo) return 0;
      const hasNoSocial = repo.open_issues_count === 0 && (ctx.pullRequestsCount || 0) === 0;
      const isYoung = ctx.repoAgeDays < 30;
      const hasStars = (repo.stargazers_count || 0) > 5;

      // Молодой репо без активности — нормально.
      // Репо со звёздами но без issues — редко.
      if (hasNoSocial && hasStars && ctx.repoAgeDays > 14) return 0.8;
      if (hasNoSocial && isYoung) return 0.3;
      return 0;
    },
    reason: (ctx) => {
      const r = ctx.repo || {};
      return `★${r.stargazers_count || 0} · issues:${r.open_issues_count || 0} · PRs:${ctx.pullRequestsCount || 0}`;
    },
  },

  {
    id: 'orphan_repo',
    weight: 0.3,
    description: 'Нет fork-предка, нет topics, нет описания — abandoned-look',
    score(ctx) {
      const repo = ctx.repo;
      if (!repo) return 0;
      let signals = 0;
      if (!repo.description || repo.description.length < 20) signals++;
      if (!repo.topics || repo.topics.length === 0) signals++;
      if (!repo.homepage) signals++;
      return signals / 3 * 0.5; // слабый сигнал сам по себе
    },
    reason: (ctx) => {
      const r = ctx.repo || {};
      const missing = [];
      if (!r.description || r.description.length < 20) missing.push('description');
      if (!r.topics?.length) missing.push('topics');
      if (!r.homepage) missing.push('homepage');
      return missing.length ? `Отсутствует: ${missing.join(', ')}` : '';
    },
  },

  {
    id: 'description_marketing_speak',
    weight: 0.5,
    description: 'Описание репо в маркетинговом стиле',
    score(ctx) {
      const desc = (ctx.repo?.description || '').toLowerCase();
      if (!desc) return 0;
      const tells = ['powerful', 'modern', 'beautiful', 'elegant', 'seamless',
                     'cutting-edge', 'state-of-the-art', 'comprehensive'];
      const hits = tells.filter(t => desc.includes(t)).length;
      return Math.min(1, hits / 2);
    },
    reason: (ctx) => {
      const desc = (ctx.repo?.description || '').toLowerCase();
      const found = ['powerful','modern','elegant','seamless','comprehensive']
        .filter(t => desc.includes(t));
      return found.length ? `В описании: ${found.join(', ')}` : '';
    },
  },
];
