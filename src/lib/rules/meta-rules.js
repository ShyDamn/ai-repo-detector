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
    description: 'Нет description — abandoned-look (homepage и topics убраны из проверки как малоинформативные)',
    score(ctx) {
      const repo = ctx.repo;
      if (!repo) return 0;
      // По фидбеку: отсутствие homepage слабо коррелирует с AI — у маленьких
      // human-проектов homepage чаще нет. Topics тоже часто пусты у легитимных
      // репо (даже cpython). Оставляем только description.
      const noDesc = !repo.description || repo.description.length < 20;
      if (!noDesc) return 0;
      // Без description + молодой репо = слабый сигнал. Старый — ещё слабее.
      const age = ctx.repoAgeDays;
      if (age < 30)  return 0.5;
      if (age < 180) return 0.3;
      return 0.15;
    },
    reason: (ctx) => {
      const r = ctx.repo || {};
      const noDesc = !r.description || r.description.length < 20;
      return noDesc ? `Нет внятного description (возраст ${ctx.repoAgeDays}д)` : '';
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
