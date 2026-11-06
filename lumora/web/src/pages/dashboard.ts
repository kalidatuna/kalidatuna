import { get } from '../api';
import { navigate } from '../router';
import { store } from '../store';
import { loading, model3d, progressRing } from '../ui/components';
import { esc, fmtDate, setTitle } from '../util';

interface Dash {
  totals: { lessons: number; completed: number; percent: number; minutes_done: number; minutes_total: number; quizzes_passed: number; quizzes_total: number };
  streak: number;
  active_days: { day: string; active: boolean }[];
  next_lesson: { slug: string; title: string; summary: string; minutes: number; locked: boolean; module_title: string; color: string; model: string } | null;
  modules: { slug: string; title: string; color: string; model: string; completed: number; total: number; quiz_passed: boolean }[];
  recent: { slug: string; title: string; at: string }[];
  certificate_ready: boolean;
  certificate_code: string | null;
}

export default async function dashboard(el: HTMLElement) {
  if (!store.user) {
    navigate('/login?next=/dashboard', { replace: true });
    return;
  }
  setTitle('Dashboard');
  el.innerHTML = loading('Loading your dashboard');
  const [d, bm] = await Promise.all([
    get<Dash>('/dashboard'),
    get<{ bookmarks: { kind: string; ref: string; title: string }[] }>('/bookmarks'),
  ]);
  const u = store.user;
  const first = esc(u.name.split(' ')[0]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const left = d.totals.lessons - d.totals.completed;
  const bookmarkHref = (b: { kind: string; ref: string }) => (b.kind === 'lesson' ? `/learn/${b.ref}` : b.kind === 'playbook' ? `/playbooks/${b.ref}` : `/prompts?focus=${b.ref}`);

  el.innerHTML = `
  <section class="container page-pad dashboard">
    <div class="dash-head">
      <div><span class="eyebrow">${greet}</span><h1>Welcome back, ${first}</h1>
      <p class="muted">${d.totals.completed === 0 ? "Let's start with something useful today." : `You've completed ${d.totals.completed} lessons. Keep the momentum going.`}</p></div>
      <span class="plan-pill ${u.has_pro ? 'pro' : ''}">${u.has_pro ? `✦ Pro · ${esc(u.plan)}` : 'Free plan'}</span>
    </div>

    ${u.has_pro ? '' : `<div class="upgrade-banner card"><div><strong>You're on the free plan.</strong> Unlock all 40 lessons, every quiz, the full prompt library and all playbooks.</div><a class="btn btn-primary btn-sm" href="/pricing">Upgrade to Pro</a></div>`}

    <div class="dash-grid">
      <div class="card stat-card">${progressRing(d.totals.percent, 120, 'complete')}<div><strong>${d.totals.completed}/${d.totals.lessons}</strong><span class="muted">lessons complete</span><span class="muted">${d.totals.minutes_done} of ${d.totals.minutes_total} minutes</span></div></div>
      <div class="card stat-card streak-card"><div class="streak-num"><span class="flame">🔥</span><strong>${d.streak}</strong></div><div><strong>day streak</strong><div class="days" aria-label="Activity in the last 14 days">${d.active_days.map((a) => `<span class="${a.active ? 'on' : ''}" title="${a.day}"></span>`).join('')}</div><span class="muted">Last 14 days</span></div></div>
      <div class="card stat-card"><div class="streak-num"><span class="flame">🎯</span><strong>${d.totals.quizzes_passed}</strong></div><div><strong>quizzes passed</strong><span class="muted">of ${d.totals.quizzes_total} modules</span></div></div>
    </div>

    ${
      d.next_lesson
        ? `<a class="continue card" href="/learn/${d.next_lesson.slug}" data-hover-host style="--c:${d.next_lesson.color}">
            ${model3d(d.next_lesson.model, d.next_lesson.color, 'model-continue')}
            <div><span class="eyebrow">${d.totals.completed ? 'Continue learning' : 'Start here'} · ${esc(d.next_lesson.module_title)}</span>
            <h2>${esc(d.next_lesson.title)}</h2><p class="muted">${esc(d.next_lesson.summary)}</p>
            <span class="btn btn-primary btn-sm">${d.next_lesson.locked ? '🔒 Unlock with Pro' : `Start lesson · ${d.next_lesson.minutes} min`}</span></div>
          </a>`
        : ''
    }

    <div class="dash-cols">
      <div>
        <h2 class="h-sm">Your modules</h2>
        <div class="dash-modules">
          ${d.modules
            .map(
              (m) => `<a class="card dash-module" href="/learn#${m.slug}" style="--c:${m.color}">
                <span class="dot" style="background:${m.color}"></span>
                <div><strong>${esc(m.title)}</strong><span class="muted">${m.completed}/${m.total} lessons${m.quiz_passed ? ' · quiz ✓' : ''}</span>
                <div class="bar"><span style="width:${Math.round((m.completed / m.total) * 100)}%"></span></div></div></a>`,
            )
            .join('')}
        </div>
      </div>
      <div class="dash-side">
        <div class="card cert-card ${d.certificate_ready ? 'ready' : ''}" data-hover-host>
          ${model3d('trophy', '#ffd166', 'model-trophy')}
          <h3>Your certificate</h3>
          ${d.certificate_ready ? '<p class="muted">You finished the whole curriculum. Amazing!</p><a class="btn btn-primary btn-sm" href="/api/certificate" target="_blank" rel="noopener">View & download</a><p class="fine">Credential ID: <a href="/verify/' + esc(d.certificate_code ?? '') + '">' + esc(d.certificate_code ?? '') + '</a>. Share this link with employers.</p>' : `<p class="muted">${left} lesson${left === 1 ? '' : 's'} to go. Finish every lesson to earn your Lumora certificate.</p>`}
        </div>
        <div class="card">
          <h3>Saved</h3>
          ${bm.bookmarks.length ? `<ul class="saved-list">${bm.bookmarks.slice(0, 8).map((b) => `<li><a href="${bookmarkHref(b)}"><span class="badge badge-${b.kind}">${b.kind}</span>${esc(b.title)}</a></li>`).join('')}</ul>` : '<p class="muted">Save lessons, prompts and playbooks with ☆ to find them here.</p>'}
        </div>
        <div class="card">
          <h3>Recent activity</h3>
          ${d.recent.length ? `<ul class="saved-list">${d.recent.map((r) => `<li><a href="/learn/${r.slug}"><span class="badge badge-done">✓</span>${esc(r.title)}<em>${fmtDate(r.at)}</em></a></li>`).join('')}</ul>` : '<p class="muted">Complete a lesson to see it here.</p>'}
        </div>
      </div>
    </div>
  </section>`;
}
