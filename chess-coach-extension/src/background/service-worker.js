/* Opens the opening trainer when the in-page panel asks for it. */
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'open-trainer') return;
  const params = new URLSearchParams();
  if (msg.line) params.set('line', msg.line);
  if (msg.color === 'w' || msg.color === 'b') params.set('color', msg.color);
  chrome.tabs.create({ url: chrome.runtime.getURL('src/trainer/trainer.html') + (params.toString() ? '?' + params : '') });
});
