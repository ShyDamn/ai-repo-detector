const tokenInput = document.getElementById('token');
const status = document.getElementById('status');

chrome.storage.local.get('gh_token').then(({ gh_token }) => {
  if (gh_token) tokenInput.value = gh_token;
});

document.getElementById('save').addEventListener('click', async () => {
  const v = tokenInput.value.trim();
  if (!v) { status.textContent = 'Пустой токен'; return; }
  await chrome.storage.local.set({ gh_token: v });
  status.textContent = '✓ Сохранено';
  setTimeout(() => status.textContent = '', 2000);
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('gh_token');
  tokenInput.value = '';
  status.textContent = '✓ Очищено';
  setTimeout(() => status.textContent = '', 2000);
});
