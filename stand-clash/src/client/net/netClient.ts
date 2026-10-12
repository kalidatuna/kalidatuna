// Thin WebSocket client with ping tracking.
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export class NetClient {
  ws: WebSocket | null = null;
  status: NetStatus = 'idle';
  ping = 0;
  url = '';
  private handlers: ((m: ServerMsg) => void)[] = [];
  private statusHandlers: ((s: NetStatus) => void)[] = [];
  private pingTimer: number | null = null;
  lastMsgAt = 0;

  static defaultUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect(url: string): Promise<void> {
    this.close();
    this.url = url;
    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.setStatus('error');
        reject(e);
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          this.setStatus('error');
          reject(new Error('Connection timed out'));
        }
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timeout);
        this.setStatus('open');
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        this.setStatus('error');
        reject(new Error('Could not connect to ' + url));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.ws === ws) this.setStatus('closed');
      };
      ws.onmessage = (ev) => {
        this.lastMsgAt = performance.now();
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (m.t === 'pong') {
          this.ping = this.ping ? this.ping * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
          return;
        }
        for (const h of this.handlers) h(m);
      };
    });
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  on(h: (m: ServerMsg) => void) {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }
  onStatus(h: (s: NetStatus) => void) {
    this.statusHandlers.push(h);
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.status = 'idle';
  }
}
