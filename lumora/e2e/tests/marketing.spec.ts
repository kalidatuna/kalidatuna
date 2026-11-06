import { expect, test } from '@playwright/test';
import { uniqueEmail, watchErrors } from './helpers';

test('landing page sells the product clearly', async ({ page }) => {
  const check = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/Lumora/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('plain English');
  await expect(page.getByRole('link', { name: /Start free, no card needed/ })).toBeVisible();
  await expect(page.locator('.module-card')).toHaveCount(10);
  await expect(page.locator('#pricing .plan-card')).toHaveCount(4);
  await expect(page.locator('#pricing')).toContainText('$99');
  await expect(page.locator('#pricing')).toContainText('$249');
  await expect(page.locator('.guarantee').first()).toContainText('money-back');
  // 3D stage boots (or falls back gracefully)
  await expect(page.locator('html')).toHaveClass(/(^|\s)(webgl|no-webgl)(\s|$)/);
  await expect(page.locator('[data-model]').first()).toBeAttached();
  // Before/after demo switches tabs
  await page.getByRole('tab', { name: 'Meal planning' }).click();
  await expect(page.locator('[data-ba-after]')).toContainText('Plan 5 weeknight dinners');
  // FAQ expands
  const faq = page.locator('.faq details').first();
  await faq.locator('summary').click();
  await expect(faq).toHaveAttribute('open', '');
  check();
});

test('lead capture delivers the free Starter Kit', async ({ page }) => {
  await page.goto('/');
  await page.locator('#lead-email').fill(uniqueEmail('lead'));
  await page.getByRole('button', { name: 'Send me the kit' }).click();
  await expect(page).toHaveURL(/\/starter-kit$/);
  await expect(page.locator('.kit-prompt')).toHaveCount(10);
  await expect(page.getByRole('heading', { name: /privacy checklist/i })).toBeVisible();
});

test('pricing page compares plans and blocks anonymous checkout', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('.compare-table tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Start yearly' }).click();
  await expect(page).toHaveURL(/\/signup\?plan=yearly/);
});

test('free lesson is readable and Pro lessons show a paywall', async ({ page, context }) => {
  const check = watchErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/learn/what-ai-really-is');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("What AI really is (and isn't)");
  await expect(page.locator('.lesson-toc a')).toHaveCount(6);
  await page.locator('.prompt-bar button').first().click();
  await expect(page.locator('.toast').last()).toContainText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('new to AI assistants');
  await page.getByRole('link', { name: /Next.*How chatbots actually work/ }).click();
  await expect(page).toHaveURL(/how-chatbots-think/);

  await page.goto('/learn/iterate-dont-restart');
  await expect(page.locator('.paywall')).toBeVisible();
  await expect(page.locator('#lesson-body')).toHaveClass(/is-preview/);
  await expect(page.locator('#lesson-body')).not.toContainText('pick and mix');
  check();
});

test('curriculum lists every module and lesson', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.locator('.module-block')).toHaveCount(10);
  await expect(page.locator('.lesson-row')).toHaveCount(40);
  await expect(page.locator('.lesson-row .badge-free')).toHaveCount(13);
});

test('search palette finds content from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.getByRole('dialog', { name: 'Search Lumora' }).getByRole('searchbox');
  await input.fill('voice clone');
  await expect(page.locator('.search-hit').first()).toBeVisible();
  await expect(page.locator('.search-results')).toContainText('Scams, deepfakes and voice clones');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/learn\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('prompt library filters, searches and hides Pro prompts', async ({ page }) => {
  await page.goto('/prompts');
  await expect(page.locator('.prompt-card').first()).toBeVisible();
  const total = await page.locator('.prompt-card').count();
  expect(total).toBeGreaterThanOrEqual(60);
  await page.getByRole('button', { name: 'Money', exact: true }).click();
  await expect(page.locator('.prompt-card .badge').filter({ hasText: /^Money$/ })).toHaveCount(await page.locator('.prompt-card').count());
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search prompts' }).fill('interview');
  await expect(page.locator('.prompt-card')).not.toHaveCount(total);
  await page.getByRole('searchbox', { name: 'Search prompts' }).fill('');
  await expect(page.locator('.prompt-card.locked').first()).toContainText('Unlock with Pro');
  await expect(page.locator('.prompt-card.locked .prompt-text')).toHaveCount(0);
});

test('prompt builder assembles and scores a prompt', async ({ page }) => {
  await page.goto('/prompt-builder');
  await expect(page.locator('[data-score]')).toHaveText('0/100');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('textarea[name=background]').fill('My landlord has ignored a leaking tap for two weeks; I reported it on the 3rd.');
  await expect(page.locator('[data-out]')).toContainText('Background: My landlord');
  await expect(page.locator('[data-out]')).toContainText('Role: Act as a warm, professional writing assistant.');
  const score = Number((await page.locator('[data-score]').textContent())!.split('/')[0]);
  expect(score).toBeGreaterThanOrEqual(65);
  await expect(page.locator('[data-open="chatgpt"]')).toHaveAttribute('href', /chatgpt\.com\/\?q=/);
});

test('glossary, tools and playbooks are browsable', async ({ page }) => {
  await page.goto('/glossary#hallucination');
  await expect(page.locator('#hallucination')).toHaveClass(/focus/);
  await page.getByRole('searchbox', { name: 'Search glossary' }).fill('token');
  await expect(page.locator('.term').first()).toContainText(/token/i);

  await page.goto('/tools');
  await expect(page.locator('.tool-card').first()).toBeVisible();
  const all = await page.locator('.tool-card').count();
  await page.getByRole('button', { name: 'Automation', exact: true }).click();
  const filtered = await page.locator('.tool-card').count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(all);

  await page.goto('/playbooks');
  await expect(page.locator('.playbook-card')).toHaveCount(10);
  await expect(page.locator('.playbook-card').first()).toContainText('Free');
  await page.locator('.playbook-card', { hasText: 'receipt' }).click();
  await expect(page.locator('#pb-body h2').first()).toBeVisible();
});

test('unknown pages show a friendly 404 and SEO files exist', async ({ page, request }) => {
  await page.goto('/this/does/not/exist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page wandered off');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBeTruthy();
  expect(await sitemap.text()).toContain('/learn/your-90-day-ai-plan');
  expect((await request.get('/robots.txt')).ok()).toBeTruthy();
});

test('theme toggle switches and persists', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Toggle light/dark theme' }).click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
});

test('landing loads fast with a small initial bundle', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
      .filter((r) => !/three-/.test(r.name));
    return { dcl: nav.domContentLoadedEventEnd, kb: scripts.reduce((s, r) => s + r.encodedBodySize, 0) / 1024 };
  });
  expect(perf.dcl).toBeLessThan(2000);
  expect(perf.kb).toBeLessThan(80);
});
