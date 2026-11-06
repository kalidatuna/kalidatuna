import '@fontsource-variable/fraunces';
import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/400.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

import { ApiError, post } from './api';
import { navigate, route, startRouter } from './router';
import { store } from './store';
import { bindShell, highlightNav, initTheme, renderFooter, renderHeader } from './ui/layout';
import { reveal, toast } from './util';
import type { Stage } from './three/stage';
import { setRefresh } from './hooks';

initTheme();

route('/', () => import('./pages/landing'));
route('/pricing', () => import('./pages/pricing'));
route('/learn', () => import('./pages/curriculum'));
route('/learn/:slug', () => import('./pages/lesson'));
route('/quiz/:slug', () => import('./pages/quiz'));
route('/prompts', () => import('./pages/prompts'));
route('/playbooks', () => import('./pages/playbooks'));
route('/playbooks/:slug', () => import('./pages/playbook'));
route('/glossary', () => import('./pages/glossary'));
route('/tools', () => import('./pages/tools'));
route('/prompt-builder', () => import('./pages/builder'));
route('/starter-kit', () => import('./pages/starter'));
route('/dashboard', () => import('./pages/dashboard'));
route('/account', () => import('./pages/account'));
route('/login', () => import('./pages/auth'));
route('/signup', () => import('./pages/auth'));
route('/checkout/demo', () => import('./pages/checkout'));
route('/welcome', () => import('./pages/welcome'));
route('/admin', () => import('./pages/admin'));
route('/terms', () => import('./pages/legal'));
route('/privacy', () => import('./pages/legal'));

let stage: Stage | null = null;
let stageLoading: Promise<void> | null = null;

function loadStage() {
  if (stageLoading) return stageLoading;
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  if (!canvas) return Promise.resolve();
  stageLoading = import('./three/stage')
    .then(({ initStage }) => {
      stage = initStage(canvas);
      stage?.scan();
    })
    .catch((e) => {
      console.warn('3D unavailable', e);
      document.documentElement.classList.add('no-webgl');
    });
  return stageLoading;
}

/** Called after every page render: refresh nav state, animations and 3D views. */
function refreshPage(path = location.pathname) {
  highlightNav(path);
  const app = document.getElementById('main')!;
  reveal(app);
  if (stage) stage.scan();
  else if (document.querySelector('[data-model]')) {
    const go = () => loadStage();
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(go, { timeout: 600 });
    else setTimeout(go, 50);
  }
}

async function checkout(plan: string, btn?: HTMLButtonElement) {
  if (!store.user) {
    navigate(`/signup?plan=${encodeURIComponent(plan)}`);
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.dataset.label = btn.textContent ?? '';
    btn.textContent = 'Opening secure checkout…';
  }
  try {
    const { url } = await post<{ url: string }>('/billing/checkout', { plan });
    if (url.startsWith('/')) navigate(url);
    else location.href = url;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not start checkout.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label ?? 'Continue';
    }
  }
}
setRefresh(() => refreshPage());

async function boot() {
  const header = document.createElement('header');
  header.className = 'site-header';
  const main = document.createElement('main');
  main.id = 'main';
  main.tabIndex = -1;
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  const app = document.getElementById('app')!;
  app.replaceChildren(header, main, footer);

  await store.boot();
  renderHeader(header);
  renderFooter(footer);
  store.subscribe(() => renderHeader(header));
  bindShell();

  document.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-checkout]');
    if (btn) {
      e.preventDefault();
      checkout(btn.dataset.checkout!, btn);
    }
  });
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  await startRouter(main, () => import('./pages/notfound'), refreshPage);
  document.documentElement.classList.add('ready');
}

boot();
