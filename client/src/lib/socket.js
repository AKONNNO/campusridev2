import { io } from 'socket.io-client';

/**
 * One shared Socket.IO connection for the whole app.
 * `connectSocket(token)` authenticates the socket (drivers/admins); students
 * connect without a token and just receive broadcasts (bus:update, ...).
 */
let socket = null;

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io(
    import.meta.env.VITE_SOCKET_URL || undefined, // same origin by default (dev proxy)
    {
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'], // polling fallback for weak links
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    }
  );
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
