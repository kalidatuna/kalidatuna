import { post } from '../api';
import { navigate } from '../router';
import { store } from '../store';
import { esc, toast } from '../util';
import { openSearch } from './search';

export const LOGO = `<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ff7ad9"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><polygon points="32,6 54,19 54,45 32,58 10,45 10,19" fill="none" stroke="url(#lg)" stroke-width="5"/><polygon points="32,20 43,26.5 43,39.5 32,46 21,39.5 21,26.5" fill="url(#lg)"/></svg>`;

const NAV = [
  ['/learn', 'Curriculum'],
  ['/prompts', 'Prompts'],
  ['/playbooks', 'Playbooks'],
  ['/prompt-builder', 'Prompt Builder'],
  ['/pricing', 'Pricing'],
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

function authArea(): string {
  const u = store.user;
  if (!u) {
    return `<a class="btn btn-ghost btn-sm" href="/login">Sign in</a><a class="btn btn-primary btn-sm" href="/signup">Start free</a>`;
  }
  return `
    <a class="btn btn-ghost btn-sm hide-sm" href="/dashboard">Dashboard</a>
    <div class="menu">
      <button class="avatar" aria-haspopup="true" aria-expanded="false" data-menu-toggle title="${esc(u.name)}">${esc(initials(u.name))}${u.has_pro ? '<span class="avatar-pro" aria-label="Pro member">PRO</span>' : ''}</button>
      <div class="menu-pop" role="menu">
        <div class="menu-head"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div>
        <a role="menuitem" href="/dashboard">Dashboard</a>
        <a role="menuitem" href="/learn">My curriculum</a>
        <a role="menuitem" href="/account">Account & billing</a>
        ${u.role === 'admin' ? '<a role="menuitem" href="/admin">Admin</a>' : ''}
        ${u.has_pro ? '' : '<a role="menuitem" class="menu-upgrade" href="/pricing">Upgrade to Pro ✦</a>'}
        <button role="menuitem" data-logout>Sign out</button>
      </div>
    </div>`;
}

export function renderHeader(host: HTMLElement) {
  host.innerHTML = `
    <div class="container header-row">
      <a class="brand" href="/" aria-label="Lumora home">${LOGO}<span>Lumora</span></a>
      <nav class="main-nav" aria-label="Main">
        ${NAV.map(([href, label]) => `<a href="${href}" data-nav="${href}">${label}</a>`).join('')}
      </nav>
      <div class="header-actions">
        <button class="icon-btn search-btn" data-search aria-label="Search (Ctrl+K)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <kbd>⌘K</kbd>
        </button>
        <button class="icon-btn" data-theme-toggle aria-label="Toggle light/dark theme">
          <svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
        <div class="auth-area">${authArea()}</div>
        <button class="icon-btn burger" data-burger aria-label="Open menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
    </div>
    <div class="mobile-nav" hidden>
      ${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}
      <a href="/glossary">Glossary</a><a href="/tools">Tool Finder</a>
      ${store.user ? '<a href="/dashboard">Dashboard</a><a href="/account">Account</a>' : '<a href="/login">Sign in</a><a class="btn btn-primary" href="/signup">Start free</a>'}
    </div>`;
}

export function highlightNav(path: string) {
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    const href = a.dataset.nav!;
    a.classList.toggle('active', path === href || path.startsWith(href + '/'));
  });
  const mobile = document.querySelector<HTMLElement>('.mobile-nav');
  if (mobile) mobile.hidden = true;
  document.querySelector('[data-burger]')?.setAttribute('aria-expanded', 'false');
}

export function renderFooter(host: HTMLElement) {
  const year = new Date().getFullYear();
  host.innerHTML = `
    <div class="container footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/">${LOGO}<span>Lumora</span></a>
        <p>Practical AI for everyday life. Plain English, real tasks, no hype.</p>
      </div>
      <div><h4>Learn</h4><a href="/learn">Curriculum</a><a href="/playbooks">Automation playbooks</a><a href="/prompts">Prompt library</a><a href="/prompt-builder">Prompt Builder</a></div>
      <div><h4>Free resources</h4><a href="/starter-kit">AI Starter Kit</a><a href="/glossary">AI glossary</a><a href="/tools">Tool Finder</a><a href="/learn/what-ai-really-is">Free first lesson</a></div>
      <div><h4>Company</h4><a href="/pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="mailto:hello@lumora.app" data-external>Contact</a></div>
    </div>
    <div class="container footer-base"><span>© ${year} Lumora. All rights reserved.</span><span>Made for curious humans. Content reviewed regularly as AI tools change.</span></div>`;
}

export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0a1a' : '#fbf7f0');
}

export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('lumora-theme');
  } catch {
    /* storage unavailable */
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(saved === 'light' || saved === 'dark' ? saved : prefersLight ? 'light' : 'dark');
}

export function bindShell() {
  document.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-theme-toggle]')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem('lumora-theme', next);
      } catch {
        /* ignore */
      }
      return;
    }
    if (t.closest('[data-search]')) {
      openSearch();
      return;
    }
    const burger = t.closest('[data-burger]');
    if (burger) {
      const nav = document.querySelector<HTMLElement>('.mobile-nav')!;
      nav.hidden = !nav.hidden;
      burger.setAttribute('aria-expanded', String(!nav.hidden));
      return;
    }
    const toggle = t.closest('[data-menu-toggle]');
    const openMenu = document.querySelector('.menu.open');
    if (toggle) {
      const menu = toggle.closest('.menu')!;
      menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(menu.classList.contains('open')));
      return;
    }
    if (openMenu && !t.closest('.menu-pop')) openMenu.classList.remove('open');
    if (t.closest('[data-logout]')) {
      await post('/auth/logout').catch(() => null);
      store.setUser(null);
      toast('Signed out. See you soon!');
      navigate('/');
    }
    if (t.closest('.menu-pop a')) document.querySelector('.menu.open')?.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') document.querySelector('.menu.open')?.classList.remove('open');
  });
}
