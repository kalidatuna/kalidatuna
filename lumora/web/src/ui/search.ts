import { get } from '../api';
import { navigate } from '../router';
import { debounce, esc } from '../util';

interface Hit {
  kind: 'lesson' | 'playbook' | 'prompt' | 'term' | 'tool';
  slug: string;
  title: string;
  snippet: string;
}

const KIND_LABEL: Record<Hit['kind'], string> = { lesson: 'Lesson', playbook: 'Playbook', prompt: 'Prompt', term: 'Glossary', tool: 'Tool' };

export function hitUrl(h: Hit): string {
  switch (h.kind) {
    case 'lesson':
      return `/learn/${h.slug}`;
    case 'playbook':
      return `/playbooks/${h.slug}`;
    case 'prompt':
      return `/prompts?focus=${h.slug}`;
    case 'term':
      return `/glossary#${h.slug}`;
    case 'tool':
      return `/tools#${h.slug}`;
  }
}

let open = false;

export function openSearch(initial = '') {
  if (open) return;
  open = true;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay search-overlay';
  overlay.innerHTML = `
    <div class="search-modal" role="dialog" aria-modal="true" aria-label="Search Lumora">
      <div class="search-input-row">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="Search lessons, prompts, playbooks, terms…" aria-label="Search" value="${esc(initial)}" />
        <kbd>Esc</kbd>
      </div>
      <div class="search-results" role="listbox"><p class="muted search-hint">Try “email”, “automation”, “privacy” or “meal plan”.</p></div>
    </div>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add('modal-open');
  const input = overlay.querySelector('input')!;
  const results = overlay.querySelector<HTMLElement>('.search-results')!;
  let hits: Hit[] = [];
  let active = 0;

  const close = () => {
    open = false;
    overlay.remove();
    document.documentElement.classList.remove('modal-open');
  };
  const paint = () => {
    results.querySelectorAll('.search-hit').forEach((el, i) => el.classList.toggle('active', i === active));
  };
  const run = debounce(async (q: string) => {
    if (q.trim().length < 2) {
      results.innerHTML = '<p class="muted search-hint">Type at least two letters.</p>';
      return;
    }
    const data = await get<{ results: Hit[] }>(`/search?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }));
    hits = data.results;
    active = 0;
    results.innerHTML = hits.length
      ? hits
          .map(
            (h, i) => `<a class="search-hit${i === 0 ? ' active' : ''}" role="option" href="${hitUrl(h)}">
              <span class="badge badge-${h.kind}">${KIND_LABEL[h.kind]}</span>
              <span class="search-hit-text"><strong>${esc(h.title)}</strong><span>${esc(h.snippet)}</span></span></a>`,
          )
          .join('')
      : `<p class="muted search-hint">No results for “${esc(q)}”. Try a simpler word.</p>`;
  }, 140);

  input.addEventListener('input', () => run(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, hits.length - 1);
      paint();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
      paint();
      e.preventDefault();
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      close();
      navigate(hitUrl(hits[active]));
    }
  });
  overlay.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
    if ((e.target as Element).closest('.search-hit')) close();
  });
  input.focus();
  if (initial) run(initial);
}
