import { get } from '../api';
import { refresh } from '../hooks';
import type { Ctx } from '../router';
import { model3d } from '../ui/components';
import { esc, fmtDate, setTitle } from '../util';

interface Verification { valid: boolean; code: string; name?: string; issued_at?: string; course?: string; lessons?: number }

export default async function verify(el: HTMLElement, ctx: Ctx) {
  setTitle('Verify a certificate');
  const v = await get<Verification>(`/verify/${encodeURIComponent(ctx.params.code)}`);
  el.innerHTML = `
  <section class="container narrow page-pad">
    <div class="card welcome-card verify-card ${v.valid ? 'is-valid' : 'is-invalid'}" data-hover-host>
      ${model3d(v.valid ? 'trophy' : 'shield', v.valid ? '#ffd166' : '#ff6b81', 'model-welcome')}
      <span class="eyebrow">Credential ${esc(v.code)}</span>
      ${
        v.valid
          ? `<h1>Verified ✓</h1><p class="lead"><strong>${esc(v.name)}</strong> completed <em>${esc(v.course)}</em> at Lumora Academy (${v.lessons} lessons), certified on ${fmtDate(v.issued_at)}.</p>`
          : `<h1>Not found</h1><p class="lead">We couldn't find a certificate with this credential ID. Check the code for typos.</p>`
      }
      <a class="btn btn-ghost" href="/">About Lumora</a>
    </div>
  </section>`;
  refresh();
}
