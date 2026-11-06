import { refresh } from '../hooks';
import { model3d } from '../ui/components';
import { setTitle } from '../util';

export default function notfound(el: HTMLElement) {
  setTitle('Page not found');
  el.innerHTML = `<section class="container narrow page-pad"><div class="card empty notfound" data-hover-host>${model3d('orb', '#8b7bff', 'model-404')}<span class="eyebrow">404</span><h1>This page wandered off</h1><p class="muted">Even AI couldn't find it. Try the curriculum or search for what you need.</p><a class="btn btn-primary" href="/">Back home</a> <a class="btn btn-ghost" href="/learn">Curriculum</a></div></section>`;
  refresh();
}
