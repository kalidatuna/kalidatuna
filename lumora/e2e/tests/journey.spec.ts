import { expect, test } from '@playwright/test';
import { PASSWORD, quizAnswers, signUp, uniqueEmail, watchErrors } from './helpers';

test('a new customer signs up, learns, buys Pro and unlocks everything', async ({ page }) => {
  const check = watchErrors(page);
  await signUp(page, 'Jordan Lee');
  // New members land on lesson 1
  await expect(page).toHaveURL(/\/learn\/what-ai-really-is/);
  await page.getByRole('button', { name: 'Mark as complete' }).click();
  await expect(page.locator('.toast').last()).toContainText('Lesson complete');
  await expect(page).toHaveURL(/how-chatbots-think/);

  // Free member hits the paywall
  await page.goto('/learn/iterate-dont-restart');
  await expect(page.locator('.paywall')).toBeVisible();
  await page.getByRole('link', { name: 'See plans' }).click();
  await expect(page).toHaveURL(/\/pricing/);

  // Buy the yearly plan
  await page.getByRole('button', { name: 'Start yearly' }).click();
  await expect(page).toHaveURL(/\/checkout\/demo\?plan=yearly/);
  await expect(page.locator('.order')).toContainText('$99');
  await page.getByRole('button', { name: 'Pay $99' }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome to Pro');
  await expect(page.locator('.avatar-pro')).toBeVisible();

  // Pro content is now unlocked
  await page.goto('/learn/iterate-dont-restart');
  await expect(page.locator('.paywall')).toHaveCount(0);
  await expect(page.locator('#lesson-body')).toContainText('pick and mix');
  await page.goto('/prompts');
  await expect(page.locator('.prompt-card.locked')).toHaveCount(0);
  await page.goto('/playbooks/enquiry-handler');
  await expect(page.locator('#pb-body')).toContainText('Step 6');

  // Dashboard reflects progress and plan
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back, Jordan');
  await expect(page.locator('.plan-pill')).toContainText('Pro');
  await expect(page.locator('.stat-card').first()).toContainText('1/40');
  await expect(page.locator('.upgrade-banner')).toHaveCount(0);

  // Account shows the active plan
  await page.goto('/account');
  await expect(page.locator('.plan-name')).toHaveText('Pro Yearly');
  await expect(page.locator('.plan-summary')).toContainText('Renews');
  check();
});

test('quizzes grade answers, explain mistakes and record a pass', async ({ page }) => {
  await signUp(page, 'Quiz Taker');
  await page.goto('/quiz/foundations');
  const questions = page.locator('fieldset.question');
  await expect(questions).toHaveCount(5);
  // Submitting early is blocked
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('.toast').last()).toContainText('Answer every question');
  // Answer everything wrong first
  const answers = quizAnswers('foundations');
  for (let i = 0; i < answers.length; i++) {
    await questions.nth(i).locator('.option').nth((answers[i] + 1) % 4).click();
  }
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('.result-card')).toContainText('Almost there');
  await expect(page.locator('.explain').first()).toContainText('Not quite.');
  await page.getByRole('button', { name: 'Try again' }).click();
  for (let i = 0; i < answers.length; i++) await questions.nth(i).locator('.option').nth(answers[i]).click();
  await expect(page.locator('[data-answered]')).toHaveText('5 of 5 answered');
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('.result-card')).toContainText('You passed!');
  await page.goto('/dashboard');
  await expect(page.locator('.stat-card').nth(2)).toContainText('1');
  // Pro quizzes are locked for free members
  await page.goto('/quiz/automation');
  await expect(page.locator('.paywall')).toBeVisible();
});

test('sign-in errors are clear and sessions survive reloads', async ({ page }) => {
  const email = await signUp(page, 'Riley Sign');
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name=password]').fill('wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-error')).toHaveText('Email or password is incorrect.');
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.reload();
  await expect(page.locator('.avatar')).toBeVisible();

  // Duplicate signup
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Dupe');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create free account' }).click();
  await expect(page.locator('.form-error')).toContainText('already exists');
});

test('members manage their account: profile, bookmarks, export, cancel, delete', async ({ page }) => {
  const email = await signUp(page, 'Casey Account');
  // Bookmark a prompt
  await page.goto('/prompts');
  await page.locator('#p-meal-plan [data-star]').click();
  await page.goto('/dashboard');
  await expect(page.locator('.saved-list')).toContainText('Weekly meal plan');

  await page.goto('/account');
  await page.locator('[data-profile] input[name=name]').fill('Casey Renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast').last()).toContainText('Profile saved');
  await expect(page.locator('.avatar')).toHaveText('CR');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my data (JSON)' }).click();
  expect((await download).suggestedFilename()).toBe('lumora-data.json');

  // Subscribe, then cancel (demo billing)
  await page.goto('/checkout/demo?plan=monthly');
  await page.getByRole('button', { name: 'Pay $14' }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.locator('.plan-name')).toHaveText('Free');

  // Delete the account
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('dialog').getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-error')).toHaveText('Email or password is incorrect.');
});

test('admins see business metrics; members cannot', async ({ page }) => {
  await signUp(page, 'Member Only');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/);
  await page.context().clearCookies();
  await signUp(page, 'Owner Admin', uniqueEmail('admin').replace(/^admin-.*@/, 'admin@'));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Business overview');
  await expect(page.locator('.kpi')).toHaveCount(6);
  await expect(page.locator('[data-rows] tr').first()).toBeVisible();
  await page.getByPlaceholder('Search name or email').fill('member only');
  await expect(page.locator('[data-rows] tr')).toHaveCount(1);
});
