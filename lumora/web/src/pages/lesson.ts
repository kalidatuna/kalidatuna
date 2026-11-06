import { ApiError, del, get, post, type LessonCard } from '../api';
import { refresh } from '../hooks';
import { navigate, type Ctx } from '../router';
import { store } from '../store';
import { enhanceProse, loading, model3d, paywall } from '../ui/components';
import { esc, setTitle, toast } from '../util';

interface LessonData {
  lesson: LessonCard & { html: string | null; preview_html: string; toc: { id: string; text: string }[]; position: number; module_lessons: number };
  module: { slug: string; title: string; color: string; model: string; number: number; is_last_lesson: boolean; quiz_questions: number };
  prev: LessonCard | null;
  next: LessonCard | null;
  signed_in: boolean;
}

export default async function lesson(el: HTMLElement, ctx: Ctx) {
  el.innerHTML = loading('Loading lesson');
  let data: LessonData;
  try {
    data = await get<LessonData>(`/lessons/${encodeURIComponent(ctx.params.slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const nf = await import('./notfound');
      return nf.default(el);
    }
    throw e;
  }
  const { lesson: l, module: m } = data;
  setTitle(l.title, l.summary);
  const [siblings, bookmarks] = await Promise.all([
    get<{ modules: { slug: string; lessons: LessonCard[] }[] }>('/curriculum').then((c) => c.modules.find((x) => x.slug === m.slug)?.lessons ?? []),
    store.user ? get<{ bookmarks: { kind: string; ref: string }[] }>('/bookmarks').then((b) => b.bookmarks) : Promise.resolve([]),
  ]);
  let saved = bookmarks.some((b) => b.kind === 'lesson' && b.ref === l.slug);
  let completed = l.completed;

  el.innerHTML = `
  <div class="read-progress" aria-hidden="true"><span></span></div>
  <section class="container lesson-layout">
    <aside class="lesson-side" aria-label="Lessons in this module">
      <a class="back-link" href="/learn#${m.slug}">← Curriculum</a>
      <div class="side-module" style="--c:${m.color}">
        <span class="eyebrow">Module ${m.number}</span>
        <strong>${esc(m.title)}</strong>
      </div>
      <ol class="side-lessons">
        ${siblings
          .map(
            (s, i) => `<li><a href="/learn/${s.slug}" class="${s.slug === l.slug ? 'current' : ''} ${s.completed ? 'done' : ''}"><span>${s.completed ? '✓' : i + 1}</span>${esc(s.title)}${s.locked ? ' <em>🔒</em>' : ''}</a></li>`,
          )
          .join('')}
        ${m.quiz_questions ? `<li><a href="/quiz/${m.slug}" class="side-quiz"><span>?</span>Module quiz</a></li>` : ''}
      </ol>
    </aside>
    <article class="lesson-main">
      <header class="lesson-head" data-hover-host>
        <div>
          <div class="lesson-crumbs"><span class="badge" style="color:${m.color}">Module ${m.number} · Lesson ${l.position} of ${l.module_lessons}</span>${l.free ? '<span class="badge badge-free">Free</span>' : '<span class="badge badge-pro">Pro</span>'}</div>
          <h1>${esc(l.title)}</h1>
          <p class="lead">${esc(l.summary)}</p>
          <div class="lesson-tools">
            <span class="muted">⏱ ${l.minutes} min read</span>
            ${store.user ? `<button class="btn btn-ghost btn-sm" data-bookmark>${saved ? '★ Saved' : '☆ Save'}</button>` : ''}
          </div>
        </div>
        ${model3d(m.model, m.color, 'model-lesson')}
      </header>
      <div class="prose ${l.locked ? 'is-preview' : ''}" id="lesson-body">${l.locked ? l.preview_html : l.html}</div>
      ${l.locked ? paywall('lesson') : ''}
      ${
        !l.locked
          ? `<div class="complete-box card">
              ${store.user ? `<div><strong>${completed ? 'Nice work! Lesson complete.' : 'Finished reading?'}</strong><span class="muted">${completed ? 'Your progress is saved.' : 'Mark it complete to track your progress and keep your streak.'}</span></div>
                <button class="btn ${completed ? 'btn-ghost' : 'btn-primary'}" data-complete>${completed ? '✓ Completed' : 'Mark as complete'}</button>`
              : `<div><strong>Save your progress</strong><span class="muted">Create a free account to track lessons, take quizzes and keep a streak.</span></div><a class="btn btn-primary" href="/signup?next=${encodeURIComponent(location.pathname)}">Create free account</a>`}
            </div>`
          : ''
      }
      ${m.is_last_lesson && m.quiz_questions && !l.locked ? `<a class="quiz-cta card" href="/quiz/${m.slug}" style="--c:${m.color}"><span class="eyebrow">Module ${m.number} complete?</span><strong>Test yourself with the ${m.quiz_questions}-question quiz →</strong></a>` : ''}
      <nav class="lesson-nav" aria-label="Lesson navigation">
        ${data.prev ? `<a class="card nav-card" href="/learn/${data.prev.slug}"><span class="muted">← Previous</span><strong>${esc(data.prev.title)}</strong></a>` : '<span></span>'}
        ${data.next ? `<a class="card nav-card next" href="/learn/${data.next.slug}"><span class="muted">Next →</span><strong>${esc(data.next.title)}</strong>${data.next.locked ? '<span class="badge badge-pro">Pro</span>' : ''}</a>` : '<a class="card nav-card next" href="/dashboard"><span class="muted">You did it →</span><strong>See your certificate</strong></a>'}
      </nav>
    </article>
    <aside class="lesson-toc" aria-label="On this page">
      ${l.toc.length ? `<span class="eyebrow">On this page</span><ul>${l.toc.map((t) => `<li><a href="#${t.id}" data-toc="${t.id}">${esc(t.text)}</a></li>`).join('')}</ul>` : ''}
    </aside>
  </section>`;

  enhanceProse(el.querySelector('#lesson-body')!);

  el.querySelector('[data-complete]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      if (completed) {
        await del(`/lessons/${l.slug}/complete`);
        completed = false;
        toast('Marked as not complete.', 'info');
      } else {
        const r = await post<{ total_completed: number }>(`/lessons/${l.slug}/complete`);
        completed = true;
        toast(`Lesson complete! ${r.total_completed} down. 🎉`);
        if (data.next && !data.next.locked) {
          setTimeout(() => navigate(`/learn/${data.next!.slug}`), 900);
        } else if (m.is_last_lesson && m.quiz_questions) {
          setTimeout(() => navigate(`/quiz/${m.slug}`), 900);
        }
      }
      btn.textContent = completed ? '✓ Completed' : 'Mark as complete';
      btn.className = `btn ${completed ? 'btn-ghost' : 'btn-primary'}`;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save progress.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelector('[data-bookmark]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const body = { kind: 'lesson', ref: l.slug };
    saved ? await del('/bookmarks', body) : await post('/bookmarks', body);
    saved = !saved;
    btn.textContent = saved ? '★ Saved' : '☆ Save';
    toast(saved ? 'Saved to your dashboard.' : 'Removed from saved.');
  });

  // Reading progress + active TOC entry
  const bar = el.querySelector<HTMLElement>('.read-progress span')!;
  const body = el.querySelector<HTMLElement>('#lesson-body')!;
  const tocLinks = [...el.querySelectorAll<HTMLAnchorElement>('[data-toc]')];
  const onScroll = () => {
    const r = body.getBoundingClientRect();
    const total = r.height - window.innerHeight * 0.6;
    const pct = Math.max(0, Math.min(1, -r.top / Math.max(total, 1)));
    bar.style.transform = `scaleX(${pct})`;
    let current = '';
    for (const a of tocLinks) {
      const h = document.getElementById(a.dataset.toc!);
      if (h && h.getBoundingClientRect().top < 140) current = a.dataset.toc!;
    }
    tocLinks.forEach((a) => a.classList.toggle('active', a.dataset.toc === current));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  refresh();
  return () => window.removeEventListener('scroll', onScroll);
}
