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

/**
 * Broadcast transaction status update to specific account rooms
 * with resilient error handling to prevent process crashes
 */
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

  for (const target of targets) {
    if (!target) continue;

    const roomId = String(target);
    try {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        logger.debug('No clients in room, skipping broadcast', { room: roomId, transactionId: payload.id });
        continue;
      }
      io.to(roomId).emit('transaction:status_update', formattedPayload);
      io.to(`user:${roomId}`).emit('transaction:status_update', formattedPayload);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn('Transaction status broadcast failed', {
        room: roomId,
        transactionId: payload.id,
        errorType: error.name,
        errorMessage: error.message,
      });
    }
  }
}

/**
 * Broadcast transaction update with resilient error handling
 */
export function emitTxUpdated(payload: { id: string; status: string; [key: string]: unknown }): void {
  if (!io) return;

  try {
    io.emit('tx_updated', payload);
    io.emit('transaction:status_update', payload);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn('Transaction update broadcast failed', {
      transactionId: payload.id,
      errorType: error.name,
      errorMessage: error.message,
    });
  }
}

/**
 * Safely emit to a specific room with comprehensive error handling
 * Handles socket serialization errors and buffer overflows gracefully
 */
export async function safeEmit(
  room: string,
  event: string,
  payload: unknown,
  options?: { timeoutMs?: number }
): Promise<{ success: boolean; error?: string }> {
  if (!io) {
    return { success: false, error: 'Socket.IO server not initialized' };
  }

  const timeoutMs = options?.timeoutMs ?? 5000;
  const startTime = Date.now();

  try {
    const rooms = io.sockets.adapter.rooms;
    if (!rooms.has(room)) {
      return { success: false, error: 'Room does not exist' };
    }

    // Validate payload is serializable
    try {
      JSON.stringify(payload);
    } catch (serializeErr) {
      return { success: false, error: 'Payload is not serializable' };
    }

    const emitPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Emit timeout'));
      }, timeoutMs);

      try {
        io!.to(room).emit(event, payload);
        clearTimeout(timeout);
        resolve();
      } catch (emitErr) {
        clearTimeout(timeout);
        reject(emitErr);
      }
    });

    await emitPromise;
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const elapsed = Date.now() - startTime;

    logger.warn('Safe emit failed', {
      room,
      event,
      elapsedMs: elapsed,
      errorType: error.name,
      errorMessage: error.message,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Broadcast to multiple rooms with error isolation.
 * Continues broadcasting to remaining rooms if one fails.
 */
export function emitToRooms(
  rooms: string[],
  event: string,
  payload: unknown
): { success: number; failed: number; errors: string[] } {
  if (!io) {
    return { success: 0, failed: rooms.length, errors: ['Socket.IO server not initialized'] };
  }

  let success = 0;
  const failed = 0;
  const errors: string[] = [];

  for (const room of rooms) {
    try {
      const roomSet = io.sockets.adapter.rooms.get(room);
      if (!roomSet || roomSet.size === 0) {
        continue;
      }
      io.to(room).emit(event, payload);
      success++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Room ${room}: ${errorMsg}`);
    }
  }

  return { success, failed: rooms.length - success, errors };
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