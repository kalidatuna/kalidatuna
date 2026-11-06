// Small, dependency-free helpers shared across pages.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for safe interpolation into HTML. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function money(cents: number, currency = 'USD'): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

export function intervalLabel(interval: string): string {
  return interval === 'month' ? '/month' : interval === 'year' ? '/year' : ' once';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} hours`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

let toastHost: HTMLElement | null = null;
export function toast(message: string, kind: 'ok' | 'error' | 'info' = 'ok') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function setTitle(title: string, description?: string) {
  document.title = title ? `${title} · Lumora` : 'Lumora · Practical AI for everyday life';
  if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
}

/** Highlights fragments of `text` matching `query` (both escaped). */
export function highlight(text: string, query: string): string {
  const safe = esc(text);
  const q = query.trim();
  if (q.length < 2) return safe;
  const pattern = new RegExp(`(${esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return safe.replace(pattern, '<mark>$1</mark>');
}

/** Reveal-on-scroll for elements with .reveal */
let io: IntersectionObserver | null = null;
export function reveal(root: ParentNode) {
  const els = root.querySelectorAll<HTMLElement>('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  io ??= new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io?.unobserve(e.target);
      }
    }),
    { rootMargin: '0px 0px -8% 0px' },
  );
  els.forEach((e) => io!.observe(e));
}
