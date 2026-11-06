import { ApiError, del, get, patch, post, type User } from '../api';
import { navigate } from '../router';
import { store } from '../store';
import { confirmDialog } from '../ui/components';
import { esc, fmtDate, money, intervalLabel, setTitle, toast } from '../util';

export default function account(el: HTMLElement) {
  const u = store.user;
  if (!u) {
    navigate('/login?next=/account', { replace: true });
    return;
  }
  setTitle('Account');
  const plan = store.config?.plans.find((p) => p.id === u.plan);
  const demo = store.config?.billing_mode === 'demo';
  el.innerHTML = `
  <section class="container narrow page-pad account">
    <span class="eyebrow">Account</span>
    <h1>Account & billing</h1>
    <div class="card acct-block">
      <h2>Your plan</h2>
      <div class="plan-summary">
        <div>
          <strong class="plan-name">${u.has_pro && plan ? esc(plan.name) : 'Free'}</strong>
          <span class="muted">${
            u.has_pro && plan
              ? `${money(plan.price_cents)}${intervalLabel(plan.interval)} · ${u.plan === 'lifetime' ? 'Lifetime access, never expires' : u.plan_renews_at ? `Renews ${fmtDate(u.plan_renews_at)}` : 'Active'}${u.plan_status === 'past_due' ? ' · <span class="warn">Payment issue: please update your card</span>' : ''}`
              : 'Foundations module, first lesson of each module, free prompts and tools.'
          }</span>
        </div>
        <div class="acct-actions">
          ${u.has_pro ? '' : '<a class="btn btn-primary btn-sm" href="/pricing">Upgrade to Pro</a>'}
          ${u.has_billing_portal ? '<button class="btn btn-secondary btn-sm" data-portal>Manage billing & invoices</button>' : ''}
          ${demo && u.has_pro && u.plan !== 'lifetime' && u.role !== 'admin' ? '<button class="btn btn-ghost btn-sm" data-demo-cancel>Cancel subscription</button>' : ''}
        </div>
      </div>
    </div>
    <form class="card acct-block" data-profile>
      <h2>Profile</h2>
      <label class="field"><span>Name</span><input name="name" value="${esc(u.name)}" maxlength="80" required /></label>
      <label class="field"><span>Email</span><input value="${esc(u.email)}" disabled /></label>
      <p class="fine">Member since ${fmtDate(u.created_at)}</p>
      <button class="btn btn-secondary btn-sm" type="submit">Save changes</button>
    </form>
    <form class="card acct-block" data-password>
      <h2>Password</h2>
      <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required /></label>
      <label class="field"><span>New password</span><input name="new" type="password" autocomplete="new-password" minlength="8" required /></label>
      <p class="fine">Changing your password signs you out on all other devices.</p>
      <button class="btn btn-secondary btn-sm" type="submit">Update password</button>
    </form>
    <div class="card acct-block">
      <h2>Your data</h2>
      <p class="muted">Download everything we store about you: your account, progress, quiz scores, saved items and payments.</p>
      <button class="btn btn-secondary btn-sm" data-export>Export my data (JSON)</button>
    </div>
    <div class="card acct-block danger-zone">
      <h2>Delete account</h2>
      <p class="muted">Permanently delete your account and all progress. This can't be undone.${u.has_billing_portal && u.plan !== 'lifetime' ? ' Cancel your subscription in billing first.' : ''}</p>
      <button class="btn btn-danger btn-sm" data-delete>Delete my account</button>
    </div>
  </section>`;

  const handle = (fn: () => Promise<void>) => async (e: Event) => {
    e.preventDefault();
    try {
      await fn();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    }
  };

  el.querySelector('[data-profile]')!.addEventListener('submit', handle(async () => {
    const name = (el.querySelector('[data-profile] input[name=name]') as HTMLInputElement).value;
    const r = await patch<{ user: User }>('/me', { name });
    store.setUser(r.user);
    toast('Profile saved.');
  }));
  el.querySelector('[data-password]')!.addEventListener('submit', handle(async () => {
    const f = el.querySelector<HTMLFormElement>('[data-password]')!;
    await post('/me/password', { current: (f.elements.namedItem('current') as HTMLInputElement).value, new: (f.elements.namedItem('new') as HTMLInputElement).value });
    f.reset();
    toast('Password updated.');
  }));
  el.querySelector('[data-export]')!.addEventListener('click', handle(async () => {
    const data = await get('/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lumora-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }));
  el.querySelector('[data-portal]')?.addEventListener('click', handle(async () => {
    const { url } = await post<{ url: string }>('/billing/portal');
    location.href = url;
  }));
  el.querySelector('[data-demo-cancel]')?.addEventListener('click', handle(async () => {
    const ok = await confirmDialog({ title: 'Cancel your subscription?', body: "You'll move to the free plan. You can re-subscribe at any time.", confirm: 'Cancel subscription', danger: true });
    if (!ok) return;
    const r = await post<{ user: User }>('/billing/demo/cancel');
    store.setUser(r.user);
    toast('Subscription canceled.');
    account(el);
  }));
  el.querySelector('[data-delete]')!.addEventListener('click', handle(async () => {
    const pw = await confirmDialog({ title: 'Delete your account?', body: 'Enter your password to permanently delete your account and all progress.', confirm: 'Delete forever', danger: true, input: { label: 'Password', type: 'password' } });
    if (!pw) return;
    await del('/me', { password: pw });
    store.setUser(null);
    toast('Your account has been deleted.');
    navigate('/');
  }));
}
