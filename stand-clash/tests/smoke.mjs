// Browser smoke test: menus → free roam, screenshots and console errors.
// Usage: node tests/smoke.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:8080';
const out = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(base + '/?test', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.screenshot({ path: out + '01-title.png' });
await page.click('#b-play');
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '02-char.png' });
await page.click('#b-ok');
await page.waitForTimeout(500);
await page.screenshot({ path: out + '03-mode.png' });
await page.click('.mode-card[data-m=free]');
await page.waitForTimeout(2500);
await page.screenshot({ path: out + '04-freeroam.png' });
const fps = await page.evaluate(() => window.__fps);
console.log('fps', fps);
console.log('errors', errors.slice(0, 10));
await browser.close();
