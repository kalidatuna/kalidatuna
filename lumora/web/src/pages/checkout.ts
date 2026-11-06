import { ApiError, post, type User } from '../api';
import { navigate, type Ctx } from '../router';
import { store } from '../store';
import { guarantee } from '../ui/components';
import { esc, intervalLabel, money, setTitle, toast } from '../util';

export default function checkout(el: HTMLElement, ctx: Ctx) {
  const plan = store.config?.plans.find((p) => p.id === ctx.query.get('plan'));
  if (!store.user) return navigate(`/signup?plan=${ctx.query.get('plan') ?? ''}`, { replace: true });
  if (!plan || store.config?.billing_mode !== 'demo') return navigate('/pricing', { replace: true });
  setTitle('Checkout');
  el.innerHTML = `
  <section class="container checkout page-pad">
    <div class="card order">
      <span class="eyebrow">Order summary</span>
      <h2>${esc(plan.name)}</h2>
      <div class="price"><span class="amount">${money(plan.price_cents)}</span><span class="per">${intervalLabel(plan.interval)}</span></div>
      <p class="muted">${esc(plan.blurb)}</p>
      <ul class="checks"><li>All 40 lessons & 10 quizzes</li><li>Full prompt library</li><li>All automation playbooks</li><li>Completion certificate</li></ul>
      <div class="order-total"><span>Total today</span><strong>${money(plan.price_cents)}</strong></div>
    </div>
    <form class="card pay">
      <div class="demo-banner">Demo checkout: no real payment is taken. Connect Stripe in production.</div>
      <h2>Payment details</h2>
      <label class="field"><span>Email</span><input value="${esc(store.user.email)}" disabled /></label>
      <label class="field"><span>Card number</span><input value="4242 4242 4242 4242" inputmode="numeric" /></label>
      <div class="field-row"><label class="field"><span>Expiry</span><input value="12 / 34" /></label><label class="field"><span>CVC</span><input value="123" /></label></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Pay ${money(plan.price_cents)}</button>
      ${guarantee()}
    </form>
  </section>`;
  el.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector<HTMLButtonElement>('form button')!;
    btn.disabled = true;
    btn.textContent = 'Processing…';
    try {
      const r = await post<{ user: User }>('/billing/demo/complete', { plan: plan.id });
      store.setUser(r.user);
      navigate(`/welcome?plan=${plan.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Payment failed.', 'error');
      btn.disabled = false;
      btn.textContent = `Pay ${money(plan.price_cents)}`;
    }
  });
}
