import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/socket-events';

let socketInstance: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (typeof window === 'undefined') {
    throw new Error('Socket is available only in browser');
  }

  if (!socketInstance) {
    socketInstance = io(process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000', {
      autoConnect: true,
    });
  }

  return socketInstance;
}
