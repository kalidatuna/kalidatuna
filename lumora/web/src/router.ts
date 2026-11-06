// Minimal history-API router with lazy-loaded pages.

export interface Ctx {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type Cleanup = () => void;
export type Page = (el: HTMLElement, ctx: Ctx) => Promise<void | Cleanup> | void | Cleanup;
type Loader = () => Promise<{ default: Page }>;

interface Route {
  pattern: string;
  regex: RegExp;
  keys: string[];
  load: Loader;
}

const routes: Route[] = [];

export function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${src}/?$`), keys };
}

export function route(pattern: string, load: Loader) {
  routes.push({ pattern, ...compile(pattern), load });
}

export function match(path: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

let outlet: HTMLElement;
let notFound: Loader;
let cleanup: Cleanup | void;
let afterRender: (path: string) => void = () => {};
let renderId = 0;

export function startRouter(el: HTMLElement, fallback: Loader, onRendered: (path: string) => void) {
  outlet = el;
  notFound = fallback;
  afterRender = onRendered;
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', () => render(false));
  return render(false);
}

function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a');
  if (!a || a.target || a.hasAttribute('download') || a.dataset.external !== undefined) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = new URL(to, location.origin);
  const same = url.pathname === location.pathname && url.search === location.search;
  if (opts.replace) history.replaceState({}, '', url);
  else if (!same || url.hash !== location.hash) history.pushState({}, '', url);
  if (same && url.hash) {
    document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    return Promise.resolve();
  }
  return render(true);
}

export async function render(scrollTop: boolean) {
  const id = ++renderId;
  const path = location.pathname;
  const found = match(path);
  const ctx: Ctx = { path, params: found?.params ?? {}, query: new URLSearchParams(location.search) };
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  outlet.setAttribute('aria-busy', 'true');
  try {
    const mod = await (found ? found.route.load() : notFound());
    if (id !== renderId) return;
    const view = document.createElement('div');
    view.className = 'view';
    outlet.replaceChildren(view);
    cleanup = await mod.default(view, ctx);
  } catch (err) {
    console.error(err);
    if (id !== renderId) return;
    outlet.innerHTML = `<section class="container narrow page-pad"><div class="card empty"><h1>Something went wrong</h1><p>Please refresh the page. If it keeps happening, contact support.</p></div></section>`;
  } finally {
    if (id === renderId) {
      outlet.removeAttribute('aria-busy');
      if (scrollTop) {
        if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
        else window.scrollTo({ top: 0 });
      }
      afterRender(path);
    }
  }
}
