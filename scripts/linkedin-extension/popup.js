const $ = (id) => document.getElementById(id);

async function render() {
  const { crmUrl, extKey, paused, lastStatus } = await chrome.storage.local.get(['crmUrl', 'extKey', 'paused', 'lastStatus']);
  $('crmUrl').value = crmUrl || 'https://payment-flow-crm-delta.vercel.app';
  $('extKey').value = extKey || '';
  $('pause').textContent = paused ? 'Reprendre' : 'Pause';
  $('status').firstChild.textContent = lastStatus ? lastStatus.text : 'Aucune action pour l’instant';
  $('at').textContent = lastStatus ? new Date(lastStatus.at).toLocaleString('fr-FR') : '';
}

$('save').onclick = async () => {
  await chrome.storage.local.set({ crmUrl: $('crmUrl').value.trim().replace(/\/$/, ''), extKey: $('extKey').value.trim() });
  chrome.alarms.create('tick', { periodInMinutes: 2 });
  $('status').firstChild.textContent = 'Enregistré';
};
$('pause').onclick = async () => {
  const { paused } = await chrome.storage.local.get('paused');
  await chrome.storage.local.set({ paused: !paused });
  render();
};
$('run').onclick = async () => {
  $('status').firstChild.textContent = 'En cours…';
  await chrome.runtime.sendMessage('run-now');
  render();
};
chrome.storage.onChanged.addListener(render);
render();
