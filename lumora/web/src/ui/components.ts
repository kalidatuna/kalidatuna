import type { CurriculumModule, ModuleSummary, Plan } from '../api';
import { store } from '../store';
import { copyText, esc, intervalLabel, money, toast } from '../util';

const FALLBACK_GLYPH: Record<string, string> = {
  orb: '◈', bubble: '❝', home: '⌂', laptop: '▣', blocks: '▦', gears: '⚙', prism: '◭', coins: '◎', shield: '⛨', rocket: '➚',
  lock: '🔒', trophy: '🏆', book: '📖', sparkle: '✦', compass: '✧', hero: '◈',
};

/** A box that the 3D stage renders a model into (with a CSS fallback glyph). */
export function model3d(name: string, color: string, cls = '') {
  return `<div class="model ${cls}" data-model="${esc(name)}" data-color="${esc(color)}" style="--c:${esc(color)}" aria-hidden="true"><span class="model-fallback">${FALLBACK_GLYPH[name] ?? '◈'}</span></div>`;
}

export function moduleCard(m: ModuleSummary | CurriculumModule, index: number, opts: { progress?: boolean } = {}) {
  const lessons = 'lesson_count' in m ? m.lesson_count : m.lessons;
  const full = m as CurriculumModule;
  const pct = opts.progress && 'completed_count' in m && lessons ? Math.round((full.completed_count / lessons) * 100) : null;
  return `
  <a class="module-card reveal" href="/learn#${esc(m.slug)}" data-hover-host style="--c:${esc(m.color)}">
    ${model3d(m.model, m.color, 'model-card')}
    <div class="module-card-body">
      <span class="eyebrow">Module ${index + 1}${m.free ? ' · <span class="free-tag">Free</span>' : ''}</span>
      <h3>${esc(m.title)}</h3>
      <p>${esc(m.tagline)}</p>
      <span class="module-meta">${lessons} lessons${'minutes' in m ? ` · ${full.minutes} min` : ''}</span>
      ${pct !== null ? `<div class="bar" aria-label="${pct}% complete"><span style="width:${pct}%"></span></div>` : ''}
    </div>
  </a>`;
}

export function planCards(plans: Plan[], opts: { compact?: boolean } = {}) {
  const user = store.user;
  const current = user?.has_pro ? user.plan : 'free';
  const monthly = plans.find((p) => p.id === 'monthly');
  const freeCard = `
    <div class="plan-card reveal">
      <h3>Free</h3>
      <div class="price"><span class="amount">$0</span><span class="per">forever</span></div>
      <p class="plan-blurb">Start learning today. No card needed.</p>
      <ul class="checks">
        <li>All of Module 1: AI Foundations</li>
        <li>First lesson of every module</li>
        <li>Free prompts, glossary & Tool Finder</li>
        <li>Prompt Builder & AI Starter Kit</li>
        <li>3 automation playbooks</li>
      </ul>
      ${user ? `<a class="btn btn-ghost btn-block" href="/learn">${current === 'free' ? 'Your current plan' : 'Included'}</a>` : '<a class="btn btn-ghost btn-block" href="/signup">Create free account</a>'}
    </div>`;
  const paid = plans
    .map((p) => {
      const saving = p.interval === 'year' && monthly ? Math.round((1 - p.price_cents / (monthly.price_cents * 12)) * 100) : 0;
      const isCurrent = current === p.id;
      const perMonth = p.interval === 'year' ? `<span class="per-month">That's ${money(Math.round(p.price_cents / 12))}/month</span>` : '';
      return `
      <div class="plan-card reveal ${p.highlight ? 'plan-featured' : ''}">
        ${p.highlight ? '<span class="plan-ribbon">Most popular</span>' : ''}
        ${p.interval === 'once' ? '<span class="plan-ribbon plan-ribbon-alt">Best value</span>' : ''}
        <h3>${esc(p.name)}</h3>
        <div class="price"><span class="amount">${money(p.price_cents)}</span><span class="per">${intervalLabel(p.interval)}</span></div>
        ${perMonth}${saving > 0 ? `<span class="save">Save ${saving}% vs monthly</span>` : ''}
        <p class="plan-blurb">${esc(p.blurb)}</p>
        ${opts.compact ? '' : `<ul class="checks">
          <li>All 10 modules & 40 lessons</li>
          <li>Every quiz + completion certificate</li>
          <li>Full prompt library (60+ prompts)</li>
          <li>All 10 automation playbooks</li>
          <li>New lessons as AI tools evolve</li>
          ${p.interval === 'once' ? '<li>Pay once, keep forever</li>' : '<li>Cancel any time in two clicks</li>'}
        </ul>`}
        <button class="btn ${p.highlight ? 'btn-primary' : 'btn-secondary'} btn-block" data-checkout="${esc(p.id)}" ${isCurrent ? 'disabled' : ''}>
          ${isCurrent ? 'Your current plan' : p.interval === 'once' ? 'Get lifetime access' : `Start ${p.interval === 'year' ? 'yearly' : 'monthly'}`}
        </button>
      </div>`;
    })
    .join('');
  return `<div class="plans">${freeCard}${paid}</div>`;
}

export function guarantee() {
  return `<p class="guarantee"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>14-day money-back guarantee. Secure checkout. Cancel any time.</p>`;
}

export function paywall(kind: 'lesson' | 'playbook' | 'quiz' | 'prompt' = 'lesson') {
  const what = { lesson: 'this lesson', playbook: 'this playbook', quiz: 'this quiz', prompt: 'these prompts' }[kind];
  const signedIn = !!store.user;
  return `
  <div class="paywall card" data-hover-host>
    ${model3d('lock', '#ff7ad9', 'model-lock')}
    <div>
      <span class="eyebrow">Lumora Pro</span>
      <h2>Unlock ${what} and everything else</h2>
      <p>Get all 40 lessons, every quiz and your certificate, the full prompt library and all 10 automation playbooks. From ${money(Math.round((store.config?.plans.find((p) => p.id === 'yearly')?.price_cents ?? 9900) / 12))}/month on the yearly plan.</p>
      <div class="paywall-actions">
        <a class="btn btn-primary" href="/pricing">See plans</a>
        ${signedIn ? '' : '<a class="btn btn-ghost" href="/signup">Create a free account</a>'}
      </div>
      ${guarantee()}
    </div>
  </div>`;
}

export function progressRing(percent: number, size = 120, label = '') {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
  return `
  <div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${percent}% complete">
    <svg viewBox="0 0 120 120"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ff7ad9"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs>
      <circle cx="60" cy="60" r="${r}" class="ring-track"/>
      <circle cx="60" cy="60" r="${r}" class="ring-fill" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
    <div class="ring-label"><strong>${percent}%</strong>${label ? `<span>${esc(label)}</span>` : ''}</div>
  </div>`;
}

/** Adds copy buttons to prompt blocks and labels to callouts inside rendered Markdown. */
export function enhanceProse(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const pre = code.parentElement!;
    const isPrompt = code.classList.contains('language-prompt');
    pre.classList.add(isPrompt ? 'prompt-block' : 'code-block');
    if (isPrompt) {
      const bar = document.createElement('div');
      bar.className = 'prompt-bar';
      bar.innerHTML = `<span>✦ Prompt: fill in the [brackets]</span><button class="btn btn-xs btn-secondary" type="button">Copy</button>`;
      const b = bar.querySelector('button')!;
      b.addEventListener('click', async () => {
        const ok = await copyText((code.textContent ?? '').trim());
        b.textContent = ok ? 'Copied ✓' : 'Copy failed';
        if (ok) toast('Prompt copied. Paste it into your AI assistant.');
        setTimeout(() => (b.textContent = 'Copy'), 1800);
      });
      pre.prepend(bar);
    }
  });
  const labels: Record<string, string> = { tip: 'Tip', note: 'Note', warning: 'Careful', important: 'Important', caution: 'Caution' };
  root.querySelectorAll<HTMLElement>('blockquote[class^="markdown-alert-"]').forEach((bq) => {
    const kind = bq.className.replace('markdown-alert-', '');
    bq.classList.add('callout', `callout-${kind}`);
    const label = document.createElement('span');
    label.className = 'callout-label';
    label.textContent = labels[kind] ?? kind;
    bq.prepend(label);
  });
  root.querySelectorAll('table').forEach((t) => {
    if (t.parentElement?.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.appendChild(t);
  });
}

export function loading(label = 'Loading') {
  return `<div class="loading" role="status"><span class="spinner"></span><span>${esc(label)}…</span></div>`;
}

export function confirmDialog(opts: { title: string; body: string; confirm: string; danger?: boolean; input?: { label: string; type: string } }): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <form class="modal card" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${esc(opts.title)}</h2>
        <p>${esc(opts.body)}</p>
        ${opts.input ? `<label class="field"><span>${esc(opts.input.label)}</span><input name="v" type="${esc(opts.input.type)}" required autocomplete="current-password"/></label>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}">${esc(opts.confirm)}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    document.documentElement.classList.add('modal-open');
    const done = (v: string | null) => {
      overlay.remove();
      document.documentElement.classList.remove('modal-open');
      resolve(v);
    };
    const form = overlay.querySelector('form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(opts.input ? (form.elements.namedItem('v') as HTMLInputElement).value : 'ok');
    });
    overlay.querySelector('[data-cancel]')!.addEventListener('click', () => done(null));
    overlay.addEventListener('click', (e) => e.target === overlay && done(null));
    overlay.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
    (form.querySelector('input') ?? form.querySelector<HTMLButtonElement>('button[type=submit]'))!.focus();
  });
}
