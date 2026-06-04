// src/lib/github-api.js
//
// Тонкая обёртка над GitHub REST API. Анонимный режим — 60 req/h.
// Если в storage есть PAT, шлём его в Authorization.

const BASE = 'https://api.github.com';

async function getToken() {
  const { gh_token } = await chrome.storage.local.get('gh_token');
  return gh_token || null;
}

async function ghFetch(path) {
  const token = await getToken();
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  if (res.status === 404) return null;
  if (res.status === 403) {
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem === '0') throw new Error('RATE_LIMIT');
    throw new Error(`Forbidden: ${path}`);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

async function fetchTotalCommits(owner, repo) {
  const token = await getToken();
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`${BASE}/repos/${owner}/${repo}/commits?per_page=1`, { headers });
    if (!res.ok) return null;
    const link = res.headers.get('link');
    if (!link) {
      // No pagination — значит ≤1 коммит
      const arr = await res.json();
      return Array.isArray(arr) ? arr.length : 0;
    }
    // Парсим: <...&page=N>; rel="last"
    const m = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

export async function fetchRepoData(owner, repo) {
  // Тянем параллельно. Если что-то падает — не блокируем остальное.
  const [repoData, readmeData, commits, pulls, tree, totalCommits] = await Promise.all([
    ghFetch(`/repos/${owner}/${repo}`).catch(() => null),
    ghFetch(`/repos/${owner}/${repo}/readme`).catch(() => null),
    ghFetch(`/repos/${owner}/${repo}/commits?per_page=30`).catch(() => []),
    ghFetch(`/repos/${owner}/${repo}/pulls?state=all&per_page=1`).catch(() => []),
    ghFetch(`/repos/${owner}/${repo}/contents`).catch(() => []),
    fetchTotalCommits(owner, repo),
  ]);

  if (!repoData) return null;

  // Для initial-commit stats нужен отдельный запрос — но только для последнего в массиве.
  const commitsArr = Array.isArray(commits) ? commits : [];
  if (commitsArr.length) {
    const first = commitsArr[commitsArr.length - 1];
    try {
      const detailed = await ghFetch(`/repos/${owner}/${repo}/commits/${first.sha}`);
      if (detailed?.stats) first.stats = detailed.stats;
    } catch { /* ignore */ }
  }

  // README приходит base64
  let readmeText = '';
  if (readmeData?.content) {
    try {
      readmeText = atob(readmeData.content.replace(/\n/g, ''));
    } catch { /* ignore */ }
  }

  // root tree → массив { path, type }
  const rootTree = Array.isArray(tree)
    ? tree.map(e => ({ path: e.name, type: e.type === 'dir' ? 'tree' : 'blob' }))
    : [];
  // .github/ может быть отдельной директорией — подтянем её
  if (rootTree.some(e => e.path === '.github')) {
    try {
      const ghContents = await ghFetch(`/repos/${owner}/${repo}/contents/.github`);
      if (Array.isArray(ghContents)) {
        for (const e of ghContents) {
          rootTree.push({
            path: `.github/${e.name}`,
            type: e.type === 'dir' ? 'tree' : 'blob',
          });
        }
      }
    } catch { /* ignore */ }
  }

  const repoAgeDays = Math.floor(
    (Date.now() - new Date(repoData.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    repo: repoData,
    readme: readmeText,
    commits: commitsArr,
    totalCommits,  // null если не удалось определить
    pullRequestsCount: Array.isArray(pulls) ? pulls.length : 0,
    rootTree,
    repoAgeDays,
  };
}
