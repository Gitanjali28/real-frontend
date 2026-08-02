import { io } from 'socket.io-client';

export const connectWS = () => {
  // ✅ FIXED: Changed to your live Render backend URL
  const socket = io('https://realchat-backend-soot.onrender.com', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return socket;
};