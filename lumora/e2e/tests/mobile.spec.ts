import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

const PAGES = ['/', '/learn', '/learn/what-ai-really-is', '/prompts', '/playbooks', '/pricing', '/prompt-builder', '/glossary', '/tools', '/signup'];

for (const path of PAGES) {
  test(`no horizontal scrolling on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}

test('mobile menu opens and navigates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.locator('.mobile-nav');
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Playbooks' }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  await expect(nav).toBeHidden();
});

test('a member can complete a lesson on a phone', async ({ page }) => {
  await signUp(page, 'Phone User');
  await expect(page).toHaveURL(/what-ai-really-is/);
  await page.getByRole('button', { name: 'Mark as complete' }).click();
  await expect(page).toHaveURL(/how-chatbots-think/);
  await page.goto('/dashboard');
  await expect(page.locator('.stat-card').first()).toContainText('1/40');
});
