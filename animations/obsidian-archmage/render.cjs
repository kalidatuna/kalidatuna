// Usage: node render.cjs <outDir> [fps] [times...]
// Renders frames of index.html (served on :8765) to PNGs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = process.argv[2] || 'frames';
  const fps = Number(process.argv[3] || 30);
  const only = process.argv.slice(4).map(Number);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8765/index.html?capture');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const times = only.length ? only : Array.from({ length: fps * 10 }, (_, i) => i / fps);
  const t0 = Date.now();
  for (let i = 0; i < times.length; i++) {
    const url = await page.evaluate(t => { window.renderAt(t); return document.querySelector('canvas').toDataURL('image/png'); }, times[i]);
    const name = only.length ? `t${times[i].toFixed(2)}.png` : `f${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    if (i % 30 === 0) console.log(`frame ${i}/${times.length} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  await browser.close();
})();
