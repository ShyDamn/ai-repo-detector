// src/lib/rules/file-rules.js
//
// Анализ surface-файлов: .github/, dependabot, CI, .gitignore, LICENSE.
// LLM любят генерить идеальный devops-обвес даже для hello-world проектов.

export const fileRules = [
  {
    id: 'over_engineered_skeleton',
    weight: 1.1,
    description: 'Преждевременный devops/tooling-обвес у молодого репо',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));

      // Расширенный список — включает то, что AI любит насовать сразу
      const tooling = [
        '.github/workflows', '.github/dependabot.yml', '.github/ISSUE_TEMPLATE',
        '.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS',
        '.editorconfig', '.prettierrc', '.eslintrc.json', 'eslint.config.ts',
        '.eslintrc.js', '.husky', '.pre-commit-config.yaml',
        'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SECURITY.md',
        'playwright.config.ts', 'vitest.config.ts', 'jest.config.js',
        'tsconfig.json', 'tsconfig.node.json',
      ];
      const present = tooling.filter(a =>
        [...names].some(n => n === a || n.startsWith(a + '/'))
      );

      // Подсчёт инфраструктуры в корне: Dockerfile*, docker-compose*, nginx.conf
      const infraFiles = [...names].filter(n =>
        /^Dockerfile/i.test(n) ||
        /^docker-compose.*\.ya?ml$/i.test(n) ||
        n === 'nginx.conf' || n === 'Makefile'
      );

      const isYoung = ctx.repoAgeDays < 60;
      const noSocial = (ctx.repo?.open_issues_count || 0) === 0 && (ctx.pullRequestsCount || 0) === 0;

      // 4+ Dockerfile/compose у одиночки — почти всегда AI ("давай я добавлю все варианты")
      if (infraFiles.length >= 4) return Math.min(1, 0.6 + present.length * 0.1);
      // 6+ tooling-артефактов у репо <60д без issues
      if (isYoung && present.length >= 6 && noSocial) return 1;
      if (present.length >= 4 && isYoung) return 0.7;
      return Math.min(0.5, (present.length + infraFiles.length) / 12);
    },
    reason: (ctx) => {
      const tree = ctx.rootTree || [];
      const names = tree.map(e => e.path);
      const infra = names.filter(n =>
        /^Dockerfile/i.test(n) || /^docker-compose.*\.ya?ml$/i.test(n) || n === 'nginx.conf'
      );
      const tools = ['eslint.config.ts', '.prettierrc', 'playwright.config.ts', 'tsconfig.json',
                     'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CONTRIBUTING.md', '.editorconfig']
        .filter(t => names.includes(t));
      const parts = [];
      if (infra.length) parts.push(`infra: ${infra.length} файла`);
      if (tools.length) parts.push(`tooling: ${tools.join(', ')}`);
      return parts.join(' · ');
    },
  },

  {
    id: 'tests_created_with_code',
    weight: 0.6,
    description: 'Папка tests/ с первого коммита и совпадающее покрытие',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const hasTests = tree.some(e =>
        /^(tests?|__tests__|spec)$/.test(e.path) && e.type === 'tree'
      );
      const isYoung = ctx.repoAgeDays < 30;
      const commitCount = ctx.totalCommits ?? (ctx.commits || []).length;
      // tests/ + ≤3 коммита = AI почти наверняка
      if (hasTests && commitCount <= 3) return 0.9;
      if (hasTests && isYoung) return 0.6;
      return 0;
    },
    reason: (ctx) => ctx.rootTree?.some(e => /^(tests?|__tests__)$/.test(e.path))
      ? 'tests/ присутствует с первого коммита' : '',
  },

  {
    id: 'doc_to_code_ratio',
    weight: 1.0,
    description: 'README непропорционально большой относительно кода',
    score(ctx) {
      const readmeKB = (ctx.readme?.length || 0) / 1024;
      const totalKB = Math.max(ctx.repo?.size || 1, 1);
      const ratio = readmeKB / totalKB;
      // 17KB README на 37KB репо = 0.46 → должно быть жёстко.
      if (ratio > 0.4) return 1;
      if (ratio > 0.25) return 0.8;
      if (ratio > 0.15) return 0.5;
      return 0;
    },
    reason: (ctx) => {
      const readmeKB = ((ctx.readme?.length || 0) / 1024).toFixed(1);
      const ratio = (readmeKB / Math.max(ctx.repo?.size || 1, 1) * 100).toFixed(0);
      return `README ${readmeKB}KB / repo ${ctx.repo?.size || 0}KB (${ratio}%)`;
    },
  },

  {
    id: 'dist_committed',
    weight: 0.8,
    description: 'dist/ или build/ закоммичены вместе с src/ — типично для AI-сгенерированных npm-пакетов',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));
      const hasDist  = ['dist', 'build', 'lib', 'out'].some(d =>
        tree.find(e => e.path === d && e.type === 'tree'));
      const hasSrc   = tree.find(e => e.path === 'src' && e.type === 'tree');
      const hasPkgJson = names.has('package.json');
      // dist + src + package.json одновременно — почти всегда AI забыл .gitignore
      if (hasDist && hasSrc && hasPkgJson) return 0.85;
      if (hasDist && hasPkgJson) return 0.4;
      return 0;
    },
    reason(ctx) {
      const tree = ctx.rootTree || [];
      const found = ['dist', 'build', 'lib', 'out'].filter(d =>
        tree.find(e => e.path === d && e.type === 'tree'));
      return found.length ? `${found.join(', ')}/ закоммичен вместе с src/+package.json` : '';
    },
  },

  {
    id: 'polished_oneshot_sdk',
    weight: 1.0,
    description: 'Polished SDK: pkg manifest + LICENSE + tsconfig + мало коммитов + соло-автор',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));
      const commits = ctx.commits || [];
      const total = ctx.totalCommits ?? commits.length;

      const hasManifest = ['package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod']
        .some(n => names.has(n));
      const hasLicense = ['LICENSE', 'LICENSE.md', 'LICENCE'].some(n => names.has(n));
      const hasTooling = ['tsconfig.json', '.prettierrc', 'eslint.config.ts', '.eslintrc.json']
        .some(n => names.has(n));

      const authors = new Set(commits.map(c => c.commit?.author?.email).filter(Boolean));
      const solo = authors.size === 1;

      // Признаки "вылизанного" пакетного репо
      const hasReadmeAndApi = /^#{1,3}[^\S\n][^\n]{0,8}?(api|api reference)\b/im.test(ctx.readme || '');

      // SDK-форма + мало коммитов + соло + tooling = почти всегда AI vibe-coded SDK
      if (hasManifest && hasLicense && hasTooling && solo && total > 0 && total <= 8) return 1;
      if (hasManifest && hasLicense && solo && total > 0 && total <= 5 && hasReadmeAndApi) return 0.85;
      if (hasManifest && hasTooling && solo && total > 0 && total <= 8) return 0.5;
      return 0;
    },
    reason(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));
      const commits = ctx.commits || [];
      const total = ctx.totalCommits ?? commits.length;
      const authors = new Set(commits.map(c => c.commit?.author?.email).filter(Boolean));
      const parts = [];
      if (['package.json','pyproject.toml','setup.py','Cargo.toml'].some(n => names.has(n))) parts.push('package');
      if (['LICENSE','LICENSE.md'].some(n => names.has(n))) parts.push('LICENSE');
      if (['tsconfig.json','.prettierrc'].some(n => names.has(n))) parts.push('tooling');
      parts.push(`${total} commit${total === 1 ? '' : 's'}`);
      parts.push(`${authors.size} author${authors.size === 1 ? '' : 's'}`);
      return parts.join(' · ');
    },
  },
];
