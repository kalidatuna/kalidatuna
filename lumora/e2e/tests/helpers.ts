import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PASSWORD = 'correct horse 42';

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

/** Fails the test on uncaught page errors or console errors (except expected 4xx fetches). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return () => expect(errors, errors.join('\n')).toEqual([]);
}

export async function signUp(page: Page, name = 'Test Learner', email = uniqueEmail()) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create free account' }).click();
  await expect(page.locator('.avatar')).toBeVisible();
  return email;
}

/** Correct answers for a module's quiz, read from the real curriculum file. */
export function quizAnswers(moduleSlug: string): number[] {
  const toml = readFileSync(fileURLToPath(new URL('../../content/curriculum.toml', import.meta.url)), 'utf8');
  const blocks = toml.split('[[modules]]').slice(1);
  const block = blocks.find((b) => b.includes(`slug = "${moduleSlug}"`));
  if (!block) throw new Error(`module ${moduleSlug} not found`);
  return [...block.matchAll(/^answer = (\d+)/gm)].map((m) => Number(m[1]));
}
