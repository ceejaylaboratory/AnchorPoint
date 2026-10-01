import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from '../services/auth.service';
import logger from '../utils/logger';
import { metricsService } from '../services/metrics.service';

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const user = await verifyToken(token);
      (socket as any).user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    logger.info('WebSocket client connected', { id: socket.id });
    metricsService.incrementWebSocketConnections();
    socket.on('disconnect', () => {
      metricsService.decrementWebSocketConnections();
      logger.info('WebSocket client disconnected', { id: socket.id });
    });
  });

  return io;
}

export function emitTxUpdated(payload: { id: string; status: string; [key: string]: unknown }): void {
  io?.emit('tx_updated', payload);
}

export function getIo(): SocketServer | null {
  return io;
}
