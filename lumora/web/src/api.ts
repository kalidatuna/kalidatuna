// Typed JSON client for the Lumora API.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  plan: 'free' | 'monthly' | 'yearly' | 'lifetime';
  plan_status: string;
  plan_renews_at: string | null;
  has_pro: boolean;
  has_billing_portal: boolean;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  interval: 'month' | 'year' | 'once';
  blurb: string;
  highlight: boolean;
}

export interface ModuleSummary {
  slug: string;
  title: string;
  tagline: string;
  model: string;
  color: string;
  lessons: number;
  free: boolean;
}

export interface SiteConfig {
  name: string;
  billing_mode: 'demo' | 'stripe';
  plans: Plan[];
  stats: {
    modules: number;
    lessons: number;
    free_lessons: number;
    minutes: number;
    prompts: number;
    playbooks: number;
    terms: number;
    tools: number;
    quiz_questions: number;
  };
  modules: ModuleSummary[];
}

export interface LessonCard {
  slug: string;
  title: string;
  summary: string;
  minutes: number;
  free: boolean;
  locked: boolean;
  completed: boolean;
}

export interface CurriculumModule {
  number: number;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  model: string;
  color: string;
  free: boolean;
  minutes: number;
  lesson_count: number;
  completed_count: number;
  quiz: { questions: number; free: boolean; best_score: number | null; passed: boolean };
  lessons: LessonCard[];
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path.startsWith('/api') ? path : `/api${path}`, init);
  } catch {
    throw new ApiError(0, 'network', 'Network problem. Check your connection and try again.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, b?: unknown) => api<T>(p, 'POST', b);
export const del = <T>(p: string, b?: unknown) => api<T>(p, 'DELETE', b);
export const patch = <T>(p: string, b?: unknown) => api<T>(p, 'PATCH', b);
