import io from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// Single shared socket instance for the entire app
// Using polling only to avoid WebSocket frame header errors and connection limits
export const socket = io(API_BASE_URL, {
  transports: ['polling'], // Polling only - more stable
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
  autoConnect: true,
  forceNew: false
});

export default socket;
