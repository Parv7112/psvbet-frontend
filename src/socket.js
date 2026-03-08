import io from "socket.io-client";

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
  // last resort: treat as origin
  return { origin: s, basePath: "/" };
}

const { origin: SOCKET_ORIGIN, basePath: RAW_BASE_PATH } = parseBaseUrl(RAW_API_BASE_URL);
const BASE_PATH = (RAW_BASE_PATH || "/").replace(/\/+$/, "") || "/";
const SOCKET_PATH = BASE_PATH === "/" ? "/socket.io" : `${BASE_PATH}/socket.io`;

export const SOCKET_DEBUG = {
  raw: RAW_API_BASE_URL,
  origin: SOCKET_ORIGIN,
  path: SOCKET_PATH
};

// Single shared socket instance for the entire app
// Using polling only to avoid WebSocket frame header errors and connection limits
export const socket = io(SOCKET_ORIGIN, {
  path: SOCKET_PATH,
  transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  reconnectionAttempts: Infinity,
  timeout: 20000,
  withCredentials: true,
  autoConnect: true,
  forceNew: false
});

export default socket;
