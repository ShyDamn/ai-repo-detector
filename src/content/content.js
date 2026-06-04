// src/content/content.js
//
// Парсит URL вида github.com/{owner}/{repo}, шлёт запрос в SW, рисует бейдж.
// Реагирует на pjax-навигацию GitHub.

const REPO_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(\/(.*)?)?$/;

function parseRepo() {
  const m = location.href.match(REPO_URL_RE);
  if (!m) return null;
  // Системные пути исключаем
  const [, owner, repo] = m;
  if (['settings', 'marketplace', 'features', 'orgs', 'topics', 'collections',
       'trending', 'search', 'pulls', 'issues', 'notifications', 'codespaces']
      .includes(owner)) return null;
  // Только основная страница репо или подстраницы того же репо
  return { owner, repo: repo.replace(/\.git$/, '') };
}

function ensureBadge() {
  let badge = document.getElementById('aird-badge');
  if (badge) return badge;
  badge = document.createElement('div');
  badge.id = 'aird-badge';
  badge.className = 'aird-badge aird-loading';
  badge.innerHTML = `
    <span class="aird-icon">⏳</span>
    <span class="aird-label">Analyzing…</span>
  `;
  badge.addEventListener('click', () => {
    const panel = document.getElementById('aird-panel');
    if (panel) panel.classList.toggle('aird-open');
  });
  document.body.appendChild(badge);
  return badge;
}

function ensurePanel() {
  let panel = document.getElementById('aird-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'aird-panel';
  panel.className = 'aird-panel';
  document.body.appendChild(panel);
  return panel;
}

function renderResult(result) {
  const badge = ensureBadge();
  const panel = ensurePanel();
  badge.classList.remove('aird-loading');
  badge.style.borderColor = result.verdict.color;
  badge.innerHTML = `
    <span class="aird-icon">${result.verdict.emoji}</span>
    <span class="aird-label">${result.verdict.label}</span>
    <span class="aird-score" style="color:${result.verdict.color}">${result.overall}</span>
  `;

  const categoryHtml = Object.entries(result.categories).map(([name, cat]) => {
    const detailsHtml = cat.details.map(d => `
      <li>
        <div class="aird-rule-head">
          <span class="aird-rule-title">${d.description}</span>
          <span class="aird-rule-score">${Math.round(d.raw * 100)}%</span>
        </div>
        ${d.reason ? `<div class="aird-rule-reason">${escapeHtml(d.reason)}</div>` : ''}
      </li>
    `).join('');
    return `
      <section class="aird-category">
        <header>
          <h4>${labelFor(name)}</h4>
          <span class="aird-cat-score">${cat.score}</span>
        </header>
        ${cat.details.length ? `<ul>${detailsHtml}</ul>` : '<p class="aird-empty">— чисто —</p>'}
      </section>
    `;
  }).join('');

  panel.innerHTML = `
    <header class="aird-panel-head">
      <h3>AI Repo Detector</h3>
      <button class="aird-close" aria-label="Close">×</button>
    </header>
    <div class="aird-summary" style="--c:${result.verdict.color}">
      <div class="aird-summary-score">${result.overall}<span>/100</span></div>
      <div class="aird-summary-label">${result.verdict.emoji} ${result.verdict.label}</div>
    </div>
    ${categoryHtml}
    <footer class="aird-foot">
      Эвристический анализ. Может ошибаться. ${result.meta.commitsAnalyzed} коммитов проанализировано.
    </footer>
  `;
  panel.querySelector('.aird-close').addEventListener('click', () => {
    panel.classList.remove('aird-open');
  });
}

function renderError(message) {
  const badge = ensureBadge();
  badge.classList.remove('aird-loading');
  badge.innerHTML = `<span class="aird-icon">⚠️</span><span class="aird-label">${escapeHtml(message)}</span>`;
}

function labelFor(name) {
  return { readme: 'README', commits: 'Commits', meta: 'Repo Meta', files: 'Files' }[name] || name;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

let currentKey = null;

async function run() {
  const parsed = parseRepo();
  if (!parsed) {
    // не репо-страница — снимаем бейдж
    document.getElementById('aird-badge')?.remove();
    document.getElementById('aird-panel')?.remove();
    currentKey = null;
    return;
  }
  const key = `${parsed.owner}/${parsed.repo}`;
  if (key === currentKey) return;
  currentKey = key;

  ensureBadge();
  ensurePanel();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_REPO',
      owner: parsed.owner,
      repo: parsed.repo,
    });
    if (!response?.ok) {
      renderError(response?.error || 'Error');
      return;
    }
    renderResult(response.data);
  } catch (e) {
    renderError(e.message);
  }
}

// GitHub использует pjax — слушаем pushState
const origPushState = history.pushState;
history.pushState = function (...args) {
  origPushState.apply(this, args);
  setTimeout(run, 300);
};
window.addEventListener('popstate', () => setTimeout(run, 300));

run();
