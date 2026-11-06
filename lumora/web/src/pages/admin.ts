import { get } from '../api';
import { navigate } from '../router';
import { store } from '../store';
import { loading } from '../ui/components';
import { debounce, esc, fmtDate, money, setTitle } from '../util';

interface Stats {
  users: number; leads: number; paying: number; plans: { monthly: number; yearly: number; lifetime: number };
  conversion_percent: number; mrr_cents: number; revenue_cents: number; lesson_completions: number;
  signups_30d: { day: string; count: number }[]; top_lessons: { slug: string; title: string; count: number }[];
}
interface Message { id: number; name: string; email: string; topic: string; message: string; created_at: string }
interface Mail { id: number; to: string; kind: string; subject: string; status: string; created_at: string }
interface AdminUser { id: number; email: string; name: string; plan: string; plan_status: string; created_at: string; lessons_completed: number }

export default async function admin(el: HTMLElement) {
  if (store.user?.role !== 'admin') return navigate('/', { replace: true });
  setTitle('Admin');
  el.innerHTML = loading('Loading metrics');
  const s = await get<Stats>('/admin/stats');
  const byDay = new Map(s.signups_30d.map((d) => [d.day, d.count]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { day: d, count: byDay.get(d) ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  el.innerHTML = `
  <section class="container page-pad admin">
    <div class="dash-head"><div><span class="eyebrow">Admin</span><h1>Business overview</h1></div><a class="btn btn-secondary btn-sm" href="/api/admin/leads.csv" download>Download leads CSV</a></div>
    <div class="kpis">
      ${[
        ['MRR', money(s.mrr_cents)],
        ['Total revenue', money(s.revenue_cents)],
        ['Paying members', String(s.paying)],
        ['Members', String(s.users)],
        ['Conversion', `${s.conversion_percent}%`],
        ['Leads', String(s.leads)],
      ].map(([k, v]) => `<div class="card kpi"><span class="muted">${k}</span><strong>${v}</strong></div>`).join('')}
    </div>
    <div class="dash-cols">
      <div class="card">
        <h3>Signups, last 30 days</h3>
        ${s.signups_30d.length ? `<div class="spark">${days.map((d) => `<span style="height:${Math.round((d.count / max) * 100)}%" title="${d.day}: ${d.count}"></span>`).join('')}</div>` : '<p class="muted">No signups yet.</p>'}
        <p class="muted">Plans: ${s.plans.monthly} monthly · ${s.plans.yearly} yearly · ${s.plans.lifetime} lifetime · ${s.lesson_completions} lesson completions</p>
      </div>
      <div class="card"><h3>Most-completed lessons</h3><ol class="top-list">${s.top_lessons.map((t) => `<li><a href="/learn/${t.slug}">${esc(t.title)}</a><span>${t.count}</span></li>`).join('') || '<li class="muted">No data yet.</li>'}</ol></div>
    </div>
    <div class="dash-cols">
      <div class="card"><h3>Inbox</h3><div data-messages class="inbox"><p class="muted">Loading…</p></div></div>
      <div class="card"><h3>Recent emails <span class="badge" data-provider></span></h3><div data-emails class="inbox"><p class="muted">Loading…</p></div></div>
    </div>
    <div class="card">
      <div class="table-head"><h3>Members</h3><input type="search" placeholder="Search name or email" data-q /></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th><th>Lessons</th><th>Joined</th></tr></thead><tbody data-rows></tbody></table></div>
    </div>
  </section>`;
  const rows = el.querySelector<HTMLElement>('[data-rows]')!;
  const load = async (q = '') => {
    const { users } = await get<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`);
    rows.innerHTML = users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.plan)}</td><td>${esc(u.plan_status)}</td><td>${u.lessons_completed}</td><td>${fmtDate(u.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No members found.</td></tr>';
  };
  load();
  get<{ messages: Message[] }>('/admin/messages').then(({ messages }) => {
    el.querySelector('[data-messages]')!.innerHTML = messages.length
      ? messages.slice(0, 20).map((m) => `<details class="msg"><summary><strong>${esc(m.topic)}</strong> · ${esc(m.name)} <span class="muted">${fmtDate(m.created_at)}</span></summary><p>${esc(m.message)}</p><a href="mailto:${esc(m.email)}" data-external>Reply to ${esc(m.email)}</a></details>`).join('')
      : '<p class="muted">No messages yet.</p>';
  });
  get<{ provider: string; emails: Mail[] }>('/admin/emails').then(({ provider, emails }) => {
    el.querySelector('[data-provider]')!.textContent = provider === 'log' ? 'not sending: connect a provider' : provider;
    el.querySelector('[data-emails]')!.innerHTML = emails.length
      ? `<ul class="saved-list">${emails.slice(0, 15).map((m) => `<li><span class="badge">${esc(m.status)}</span>${esc(m.subject)}<em>${esc(m.to)}</em></li>`).join('')}</ul>`
      : '<p class="muted">No emails yet.</p>';
  });
  el.querySelector('[data-q]')!.addEventListener('input', debounce((e: Event) => load((e.target as HTMLInputElement).value), 200));
}
