const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function parseBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    const u = new URL(s);
    return { origin: u.origin, basePath: u.pathname || "/" };
  }
  if (s.startsWith("/")) {
    return { origin: window.location.origin, basePath: s };
  }
  return { origin: s, basePath: "/" };
}

const { origin: API_ORIGIN, basePath: RAW_BASE_PATH } = parseBaseUrl(RAW_API_BASE_URL);
const BASE_PATH = (RAW_BASE_PATH || "/").replace(/\/+$/, "") || "/";
const WS_PATH = BASE_PATH === "/" ? "/ws" : `${BASE_PATH}/ws`;

export const SOCKET_DEBUG = {
  raw: RAW_API_BASE_URL,
  origin: API_ORIGIN,
  path: WS_PATH
};

class WSClient {
  constructor() {
    this._ws = null;
    this._connected = false;
    this.id = "";
    this._handlers = new Map(); // event -> Set<fn>
    this._pending = new Map(); // requestId -> fn
    this._connectPromise = null;

    // auto-connect
    this.connect();
  }

  get connected() {
    return this._connected;
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this._handlers.delete(event);
  }

  _emitLocal(event, ...args) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch {
        // ignore
      }
    }
  }

  async connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return this._connectPromise || Promise.resolve();
    }

    const wsUrl = `${API_ORIGIN.replace(/^http/, "ws")}${WS_PATH}`;

    this._connectPromise = new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      this._ws = ws;

      ws.onopen = () => {
        this._connected = true;
        this._emitLocal("connect");
        resolve();
      };

      ws.onclose = (ev) => {
        this._connected = false;
        this._emitLocal("disconnect", ev?.reason || "closed");
        // simple reconnect
        setTimeout(() => {
          if (!this._connected) this.connect();
        }, 1000);
      };

      ws.onerror = () => {
        this._emitLocal("connect_error", { message: "websocket error" });
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg?.type === "ws-hello") {
          this.id = msg.id || "";
          this._emitLocal("hello", { id: this.id });
          return;
        }

        if (msg?.type === "ack" && msg.requestId) {
          const cb = this._pending.get(msg.requestId);
          if (cb) {
            this._pending.delete(msg.requestId);
            cb(msg);
          }
          return;
        }

        if (msg?.type) {
          this._emitLocal(msg.type, msg);
        }
      };
    });

    return this._connectPromise;
  }

  disconnect() {
    try {
      this._ws?.close();
    } catch {
      // ignore
    }
  }

  emit(type, payload = {}, ack) {
    const hasAck = typeof ack === "function";
    const requestId = hasAck
      ? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
      : undefined;

    const msg = { type, ...(payload || {}) };
    if (hasAck) msg.requestId = requestId;

    if (hasAck) {
      this._pending.set(requestId, ack);
      setTimeout(() => {
        if (this._pending.has(requestId)) {
          this._pending.delete(requestId);
          ack({ ok: false, requestId, message: "ack timeout" });
        }
      }, 8000);
    }

    try {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(msg));
      }
    } catch {
      // ignore
    }
  }
}

export const socket = new WSClient();
export default socket;
