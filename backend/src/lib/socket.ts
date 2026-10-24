import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from '../services/auth.service';
import prisma from './prisma';
import logger from '../utils/logger';
import { metricsService } from '../services/metrics.service';

let io: SocketServer | null = null;

export interface TransactionStatusUpdatePayload {
  id: string;
  status: string;
  updated_at: string;
  stellar_transaction_id: string | null;
}

export async function socketAuthMiddleware(socket: any, next: (err?: any) => void): Promise<void> {
  const queryToken = socket.handshake?.query?.token;
  const authToken = socket.handshake?.auth?.token;
  const authHeader = socket.handshake?.headers?.authorization;
  let token = typeof queryToken === 'string' ? queryToken : Array.isArray(queryToken) ? queryToken[0] : null;
  if (!token && typeof authToken === 'string') {
    token = authToken;
  }
  if (!token && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) return next(new Error('Authentication required'));
  try {
    const user = await verifyToken(token);
    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
}

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', async (socket: Socket) => {
    logger.info('WebSocket client connected', { id: socket.id });
    metricsService.incrementWebSocketConnections();

    const user = (socket as any).user;
    if (user?.sub) {
      socket.join(user.sub);
      socket.join(`user:${user.sub}`);
      try {
        const dbUser = await prisma.user.findFirst({
          where: {
            OR: [{ publicKey: user.sub }, { id: user.sub }],
          },
        });
        if (dbUser) {
          socket.join(dbUser.id);
          socket.join(`user:${dbUser.id}`);
          socket.join(dbUser.publicKey);
          socket.join(`user:${dbUser.publicKey}`);
          (socket as any).userId = dbUser.id;
        }
      } catch (err) {
        logger.warn('Failed to resolve user for socket room', { error: err });
      }
    }

    socket.on('join', (room: string) => {
      if (typeof room === 'string' && room.trim()) {
        socket.join(room);
      }
    });

    socket.on('disconnect', () => {
      metricsService.decrementWebSocketConnections();
      logger.info('WebSocket client disconnected', { id: socket.id });
    });
  });

  return io;
}

export function emitTransactionStatusUpdate(
  userIdOrPublicKey: string | string[],
  payload: {
    id: string;
    status: string;
    updated_at: string | Date;
    stellar_transaction_id?: string | null;
  }
): void {
  if (!io) return;
  const formattedPayload: TransactionStatusUpdatePayload = {
    id: payload.id,
    status: payload.status,
    updated_at: payload.updated_at instanceof Date ? payload.updated_at.toISOString() : String(payload.updated_at),
    stellar_transaction_id: payload.stellar_transaction_id ?? null,
  };

  const targets = Array.isArray(userIdOrPublicKey) ? userIdOrPublicKey : [userIdOrPublicKey];
  let broadcaster: any = io;
  for (const target of targets) {
    if (target) {
      broadcaster = broadcaster.to(target).to(`user:${target}`);
    }
  }
  broadcaster.emit('transaction:status_update', formattedPayload);
}

export function emitTxUpdated(payload: { id: string; status: string; [key: string]: unknown }): void {
  io?.emit('tx_updated', payload);
  io?.emit('transaction:status_update', payload);
}

export function getIo(): SocketServer | null {
  return io;
}

export function setIo(server: SocketServer | null): void {
  io = server;
}

export async function closeSocket(): Promise<void> {
  if (io) {
    const currentIo = io;
    io = null;
    if (typeof (currentIo as any).close === 'function') {
      await new Promise<void>((resolve) => {
        try {
          let resolved = false;
          const safeResolve = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          const res = (currentIo as any).close((_err?: any) => safeResolve());
          if (res && typeof res.then === 'function') {
            res.then(() => safeResolve(), () => safeResolve());
          } else {
            setTimeout(safeResolve, 50);
          }
        } catch {
          resolve();
        }
      });
    }
  }
}

