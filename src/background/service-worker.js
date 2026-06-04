// src/background/service-worker.js
//
// Получает запросы от content script, делает API + анализ, кэширует в session.
// Cache TTL: 1 час. Ключ: owner/repo.

import { fetchRepoData } from '../lib/github-api.js';
import { analyze } from '../lib/scorer.js';

const CACHE_TTL_MS = 60 * 60 * 1000;

async function getCached(key) {
  const all = await chrome.storage.session.get(key);
  const entry = all[key];
  if (entry && Date.now() - entry.t < CACHE_TTL_MS) return entry.v;
  return null;
}

async function setCached(key, value) {
  await chrome.storage.session.set({ [key]: { t: Date.now(), v: value } });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'ANALYZE_REPO') return false;

  (async () => {
    const { owner, repo } = msg;
    const key = `${owner}/${repo}`;
    try {
      const cached = await getCached(key);
      if (cached) {
        sendResponse({ ok: true, data: cached, cached: true });
        return;
      }
      const ctx = await fetchRepoData(owner, repo);
      if (!ctx) {
        sendResponse({ ok: false, error: 'Repo not found' });
        return;
      }
      const result = analyze(ctx);
      await setCached(key, result);
      sendResponse({ ok: true, data: result, cached: false });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true; // keep channel open for async sendResponse
});
