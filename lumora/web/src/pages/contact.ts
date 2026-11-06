import { ApiError, post } from '../api';
import { refresh } from '../hooks';
import type { Ctx } from '../router';
import { store } from '../store';
import { model3d } from '../ui/components';
import { esc, setTitle } from '../util';

const TOPICS = ['Question about the course', 'Billing & refunds', 'Teams & companies', 'Technical problem', 'Feedback', 'Other'];

export default function contact(el: HTMLElement, ctx: Ctx) {
  setTitle('Contact us', 'Questions about Lumora, billing, team plans or anything else? A real person replies within one business day.');
  const topic = ctx.query.get('topic') ?? '';
  const u = store.user;
  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div><span class="eyebrow">Contact</span><h1>Talk to a <span class="grad">real human</span></h1>
      <p class="lead">Questions about the course, billing, refunds or training your team? Send us a message and we'll reply within one business day.</p></div>
      ${model3d('bubble', '#ff7ad9', 'model-head')}
    </div>
    <div class="contact-grid">
      <form class="card contact-form" novalidate>
        <div class="field-row">
          <label class="field"><span>Your name</span><input name="name" autocomplete="name" value="${esc(u?.name ?? '')}" required maxlength="80" /></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" value="${esc(u?.email ?? '')}" required /></label>
        </div>
        <label class="field"><span>Topic</span><select name="topic" required><option value="">Choose a topic…</option>${TOPICS.map((t) => `<option ${t === topic ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span>Message</span><textarea name="message" rows="6" required minlength="10" maxlength="5000" placeholder="How can we help?"></textarea></label>
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary btn-lg" type="submit">Send message</button>
      </form>
      <div class="contact-side">
        <div class="card sent" hidden><h3>Message sent ✓</h3><p class="muted">Thanks! We've emailed you a confirmation and will reply within one business day.</p></div>
        <div class="card"><h3>Quick answers</h3><ul class="saved-list">
          <li><a href="/pricing">Plans & pricing</a></li><li><a href="/refunds">14-day refund policy</a></li>
          <li><a href="/forgot-password">Reset your password</a></li><li><a href="/learn/what-ai-really-is">Start the free lessons</a></li></ul></div>
        <div class="card"><h3>Teams & companies</h3><p class="muted">Training 5 or more people? Choose "Teams & companies" and tell us your team size. We'll send volume pricing and a rollout plan.</p></div>
      </div>
    </div>
  </section>`;
  const form = el.querySelector<HTMLFormElement>('.contact-form')!;
  const error = el.querySelector<HTMLElement>('.form-error')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    error.textContent = '';
    if (!data.name.trim()) return void (error.textContent = 'Please tell us your name.');
    if (!/^\S+@\S+\.\S+$/.test(data.email)) return void (error.textContent = 'Please enter a valid email address.');
    if (!data.topic) return void (error.textContent = 'Please choose a topic.');
    if (data.message.trim().length < 10) return void (error.textContent = 'Please write a little more (at least 10 characters).');
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      await post('/contact', data);
      form.hidden = true;
      el.querySelector<HTMLElement>('.sent')!.hidden = false;
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Could not send your message. Please try again.';
      btn.disabled = false;
    }
  });
  refresh();
}
