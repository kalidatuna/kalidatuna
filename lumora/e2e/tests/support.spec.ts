import { expect, test, type APIRequestContext } from '@playwright/test';
import { PASSWORD, signUp, uniqueEmail } from './helpers';

const json = { 'content-type': 'application/json' };

/** Signs an admin in on a separate API context and returns the latest email body sent to `to`. */
async function latestEmail(request: APIRequestContext, to: string, kind: string) {
  const login = await request.post('/api/auth/login', { headers: json, data: { email: 'admin@e2e.test', password: PASSWORD } });
  if (!login.ok()) await request.post('/api/auth/signup', { headers: json, data: { name: 'E2E Admin', email: 'admin@e2e.test', password: PASSWORD } });
  const res = await request.get(`/api/admin/emails?to=${encodeURIComponent(to)}`);
  const { emails } = (await res.json()) as { emails: { kind: string; body: string }[] };
  const mail = emails.find((e) => e.kind === kind);
  expect(mail, `no ${kind} email for ${to}`).toBeTruthy();
  return mail!.body;
}

test('a member who forgot their password can reset it from the emailed link', async ({ page, request }) => {
  const email = await signUp(page, 'Forgetful Fran');
  expect(await latestEmail(request, email, 'welcome')).toContain('Start lesson 1');
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  const body = await latestEmail(request, email, 'password_reset');
  const link = body.match(/https?:\/\/\S+reset-password\?token=\S+/)![0];
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.getByLabel('New password', { exact: true }).fill('fresh password 99');
  await page.getByLabel('Confirm password').fill('different');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.locator('.form-error')).toHaveText("Those passwords don't match.");
  await page.getByLabel('Confirm password').fill('fresh password 99');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back, Forgetful');

  // The link only works once
  await page.context().clearCookies();
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.getByLabel('New password', { exact: true }).fill('another pass 77');
  await page.getByLabel('Confirm password').fill('another pass 77');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.locator('.form-error')).toContainText('invalid or has expired');
});

test('visitors can contact support and get a confirmation', async ({ page, request }) => {
  const email = uniqueEmail('contact');
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Talk to us' }).click();
  await expect(page).toHaveURL(/\/contact\?topic=Teams/);
  await expect(page.getByLabel('Topic')).toHaveValue('Teams & companies');
  await page.getByLabel('Your name').fill('Taylor Teams');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Message').fill('short');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.form-error')).toContainText('at least 10 characters');
  await page.getByLabel('Message').fill('We would like Lumora for 30 people in our office.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Message sent ✓')).toBeVisible();
  expect(await latestEmail(request, email, 'contact_receipt')).toContain('real person');
});

test('certificate verification and policy pages', async ({ page }) => {
  await page.goto('/verify/LUM-NOPE-NOPE');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  await page.goto('/refunds');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Refund policy');
  await expect(page.locator('.prose')).toContainText('14-day money-back guarantee');
  await page.goto('/');
  await page.locator('.site-footer').getByRole('link', { name: 'Refund policy' }).click();
  await expect(page).toHaveURL(/\/refunds$/);
});

test('graduates receive a shareable, verifiable certificate', async ({ page, request }) => {
  await signUp(page, 'Graduate Gabi');
  // Fast-forward through the course via the API (same session cookies as the page)
  const api = page.context().request;
  await api.post('/api/billing/demo/complete', { headers: json, data: { plan: 'lifetime' } });
  const cur = await (await api.get('/api/curriculum')).json();
  for (const m of cur.modules) for (const l of m.lessons) await api.post(`/api/lessons/${l.slug}/complete`, { headers: json, data: {} });
  await page.goto('/dashboard');
  const link = page.locator('.cert-card .fine a');
  await expect(link).toHaveText(/^LUM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const code = await link.textContent();
  const svg = await api.get('/api/certificate');
  expect(await svg.text()).toContain(code!);
  // Anyone can verify it
  const anon = await request.get(`/api/verify/${code}`);
  expect((await anon.json()).name).toBe('Graduate Gabi');
  await link.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verified ✓');
  await expect(page.locator('.verify-card')).toContainText('Graduate Gabi');
});
