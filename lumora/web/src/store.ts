// Global session + site configuration, with change subscriptions.
import { get, type SiteConfig, type User } from './api';

type Listener = () => void;

class Store {
  user: User | null = null;
  config: SiteConfig | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setUser(user: User | null) {
    this.user = user;
    this.listeners.forEach((l) => l());
  }

  async boot() {
    const [me, config] = await Promise.all([
      get<{ user: User | null }>('/me').catch(() => ({ user: null })),
      get<SiteConfig>('/config').catch(() => null),
    ]);
    this.user = me.user;
    this.config = config;
  }

  async refreshUser() {
    const me = await get<{ user: User | null }>('/me').catch(() => ({ user: null }));
    this.setUser(me.user);
  }
}

export const store = new Store();
