// src/lib/rules/file-rules.js
//
// Анализ surface-файлов: .github/, dependabot, CI, .gitignore, LICENSE.
// LLM любят генерить идеальный devops-обвес даже для hello-world проектов.

export const fileRules = [
  {
    id: 'over_engineered_skeleton',
    weight: 1.1,
    description: 'Преждевременный devops/tooling-обвес (CI templates, husky, pre-commit, security policies)',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));

      // Tooling-список без УНИВЕРСАЛЬНЫХ файлов: .editorconfig, .gitignore,
      // базовый tsconfig.json и .prettierrc сами по себе не AI-сигнал —
      // их копипастят все. Оставляем то, что реально требует усилий
      // и встречается у AI-vibe-coded репо чаще, чем у людей.
      const tooling = [
        '.github/workflows', '.github/dependabot.yml', '.github/ISSUE_TEMPLATE',
        '.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS',
        '.husky', '.pre-commit-config.yaml',
        'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SECURITY.md',
        'playwright.config.ts', 'vitest.config.ts', 'jest.config.js',
        'eslint.config.ts', 'eslint.config.js',
        'commitlint.config.js', 'release.config.js',
      ];
      const present = tooling.filter(a =>
        [...names].some(n => n === a || n.startsWith(a + '/'))
      );

      const infraFiles = [...names].filter(n =>
        /^Dockerfile/i.test(n) ||
        /^docker-compose.*\.ya?ml$/i.test(n) ||
        n === 'nginx.conf' || n === 'Makefile'
      );

      const isYoung = ctx.repoAgeDays < 60;
      const noSocial = (ctx.repo?.open_issues_count || 0) === 0 && (ctx.pullRequestsCount || 0) === 0;

      // 4+ Dockerfile/compose у одиночки — почти всегда AI ("давай я добавлю все варианты")
      let base = 0;
      if (infraFiles.length >= 4) base = Math.min(1, 0.6 + present.length * 0.1);
      else if (isYoung && present.length >= 6 && noSocial) base = 1;
      else if (present.length >= 4 && isYoung) base = 0.7;
      else if (present.length >= 6) base = 0.4;  // много tooling, но репо не молодой — мягче
      else base = Math.min(0.3, (present.length + infraFiles.length) / 15);

      // Hard age-decay: старый репо не может быть «преждевременно» обвешан
      const age = ctx.repoAgeDays;
      if (age > 3 * 365) return base * 0.1;
      if (age > 365)     return base * 0.35;
      if (age > 180)     return base * 0.65;
      return base;
    },
    reason: (ctx) => {
      const tree = ctx.rootTree || [];
      const names = tree.map(e => e.path);
      const infra = names.filter(n =>
        /^Dockerfile/i.test(n) || /^docker-compose.*\.ya?ml$/i.test(n) || n === 'nginx.conf'
      );
      const tools = ['.husky', '.pre-commit-config.yaml', 'eslint.config.ts',
                     'playwright.config.ts', 'vitest.config.ts',
                     'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CONTRIBUTING.md',
                     '.github/dependabot.yml', '.github/CODEOWNERS']
        .filter(t => names.includes(t) || names.some(n => n.startsWith(t + '/')));
      const parts = [];
      if (infra.length) parts.push(`infra: ${infra.length} файла`);
      if (tools.length) parts.push(`tooling: ${tools.join(', ')}`);
      const age = ctx.repoAgeDays;
      if (age > 365 && parts.length) parts.push(`(возраст ${Math.floor(age / 365)}y, сигнал ослаблен)`);
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
    description: 'Polished one-shot SDK/проект: pkg manifest + LICENSE + tooling + мало коммитов + соло',
    score(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));
      const commits = ctx.commits || [];
      const total = ctx.totalCommits ?? commits.length;

      const hasManifest = ['package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod',
                           'composer.json', 'Gemfile']
        .some(n => names.has(n));
      const hasLicense = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']
        .some(n => names.has(n));
      // Tool링ом считаем что угодно показывающее, что репо "профессионально оформлен".
      // Кросс-стек: JS/TS + Python + Rust + Go.
      const toolingMarkers = [
        // JS/TS
        'tsconfig.json', '.prettierrc', '.prettierrc.json', 'eslint.config.ts', 'eslint.config.js',
        '.eslintrc.json', '.eslintrc.js', 'vite.config.ts', 'vitest.config.ts',
        // Python
        '.pre-commit-config.yaml', 'tox.ini', 'pytest.ini', 'mypy.ini', 'ruff.toml',
        'setup.cfg', 'uv.lock', '.python-version', 'poetry.lock',
        // Rust
        'Cargo.lock', 'rustfmt.toml', 'clippy.toml',
        // Go
        'go.sum', 'Makefile',
        // PHP
        'phpunit.xml', 'phpstan.neon', '.php-cs-fixer.dist.php',
      ];
      const toolingCount = toolingMarkers.filter(n => names.has(n)).length;
      const hasTooling = toolingCount >= 1;

      // Solo — по уникальным NAMES (а не email), потому что один человек
      // часто имеет несколько email-алиасов (noreply, личный, рабочий).
      // Игнорируем "root", "user", "admin", "Default User" — типичный artifact
      // Docker-контейнера/CI/dev-окружения, где AI делал initial commit.
      const IGNORE_NAMES = /^(root|user|admin|default user|github|ubuntu|builder)$/i;
      const authorNames = new Set(
        commits.map(c => c.commit?.author?.name)
          .filter(n => n && !IGNORE_NAMES.test(n.trim()))
      );
      const solo = authorNames.size === 1;

      // Признаки "вылизанного" пакетного репо
      const hasReadmeAndApi = /^#{1,3}[^\S\n][^\n]{0,8}?(api|api reference)\b/im.test(ctx.readme || '');

      // SDK-форма + мало коммитов + соло + tooling = почти всегда AI vibe-coded SDK
      if (hasManifest && hasLicense && hasTooling && solo && total > 0 && total <= 8) return 1;
      if (hasManifest && hasLicense && solo && total > 0 && total <= 5 && hasReadmeAndApi) return 0.85;
      if (hasManifest && hasTooling && solo && total > 0 && total <= 8) return 0.65;
      // Без LICENSE, но с manifest+tooling и совсем мало коммитов
      if (hasManifest && hasTooling && solo && total > 0 && total <= 10 && toolingCount >= 2) return 0.5;
      return 0;
    },
    reason(ctx) {
      const tree = ctx.rootTree || [];
      const names = new Set(tree.map(e => e.path));
      const commits = ctx.commits || [];
      const total = ctx.totalCommits ?? commits.length;
      const authorNames = new Set(commits.map(c => c.commit?.author?.name).filter(Boolean));
      const parts = [];
      if (['package.json','pyproject.toml','setup.py','Cargo.toml','composer.json','go.mod','Gemfile'].some(n => names.has(n))) parts.push('manifest');
      if (['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','COPYING'].some(n => names.has(n))) parts.push('LICENSE');
      const toolingMarkers = ['tsconfig.json','.prettierrc','eslint.config.ts','.pre-commit-config.yaml','uv.lock','Cargo.lock','phpstan.neon','vite.config.ts','playwright.config.ts'];
      const foundTools = toolingMarkers.filter(t => names.has(t));
      if (foundTools.length) parts.push(`tooling: ${foundTools.slice(0, 3).join(',')}`);
      parts.push(`${total} commit${total === 1 ? '' : 's'}`);
      parts.push(`${authorNames.size} author${authorNames.size === 1 ? '' : 's'}`);
      return parts.join(' · ');
    },
  },
];
