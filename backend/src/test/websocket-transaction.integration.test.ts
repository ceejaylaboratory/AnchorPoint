import http from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  initSocket,
  emitTransactionStatusUpdate,
  closeSocket,
  getIo,
  setIo,
  socketAuthMiddleware,
} from '../lib/socket';
import prisma from '../lib/prisma';
import transactionsRouter from '../api/routes/transactions.route';
import { SEP31Service } from '../services/sep31.service';
import { updateTransactionStatusAndNotify } from '../services/webhook.service';
import { TransactionReconcileScheduler } from '../workers/transaction-reconcile.scheduler';
import { stellarService } from '../services/stellar.service';
import { metricsService } from '../services/metrics.service';

const sep31Service = new SEP31Service();

const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';

// Mock dependencies
jest.mock('../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  transaction: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $queryRawUnsafe: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../utils/tracing', () => {
  const dummySpan = {
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
  };
  return {
    traceAsync: (_name: any, fn: any) => fn(dummySpan),
    traceSync: (_name: any, fn: any) => fn(dummySpan),
    SpanKind: {},
    initTracing: jest.fn(),
    createTraceExporter: jest.fn(),
  };
});

jest.mock('../lib/redis', () => {
  const client = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
    duplicate: jest.fn().mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
      subscribe: jest.fn(),
    }),
  };
  return {
    __esModule: true,
    default: client,
    redisClient: client,
    redis: client,
  };
});

jest.mock('../api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    notify: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    incrementWebSocketConnections: jest.fn(),
    decrementWebSocketConnections: jest.fn(),
    incrementTransactionReconciliation: jest.fn(),
  },
}));

/**
 * Mock Socket Client simulating a client connected to Socket.io
 */
class MockSocketClient {
  public id: string;
  public user?: any;
  public rooms: Set<string> = new Set();
  public emittedEvents: { event: string; data: any }[] = [];
  public handshake: { query: Record<string, any>; auth: Record<string, any>; headers: Record<string, any> };
  private listeners: Map<string, Function[]> = new Map();

  constructor(id: string, queryToken?: string, authToken?: string) {
    this.id = id;
    this.rooms.add(id);
    this.handshake = {
      query: queryToken ? { token: queryToken } : {},
      auth: authToken ? { token: authToken } : {},
      headers: {},
    };
  }

  join(room: string) {
    this.rooms.add(room);
  }

  leave(room: string) {
    this.rooms.delete(room);
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, ...args: any[]) {
    this.emittedEvents.push({ event, data: args[0] });
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  trigger(event: string, ...args: any[]) {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

describe('WebSocket Transaction Updates Integration Test', () => {
  const user1PublicKey = 'G_USER_ONE_PUBLIC_KEY';
  const user1Id = 'user_1_id';
  const user2PublicKey = 'G_USER_TWO_PUBLIC_KEY';
  const user2Id = 'user_2_id';

  let user1Token: string;
  let user2Token: string;
  let app: express.Express;

  beforeAll(() => {
    user1Token = jwt.sign({ sub: user1PublicKey }, JWT_SECRET);
    user2Token = jwt.sign({ sub: user2PublicKey }, JWT_SECRET);

    app = express();
    app.use(express.json());
    app.use('/api/transactions', transactionsRouter);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await closeSocket();

    (prisma.user.findFirst as jest.Mock).mockImplementation(async ({ where }: any) => {
      const or = where?.OR || [];
      for (const cond of or) {
        if (cond.publicKey === user1PublicKey || cond.id === user1PublicKey || cond.id === user1Id) {
          return { id: user1Id, publicKey: user1PublicKey };
        }
        if (cond.publicKey === user2PublicKey || cond.id === user2PublicKey || cond.id === user2Id) {
          return { id: user2Id, publicKey: user2PublicKey };
        }
      }
      return null;
    });

    (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: any) => {
      if (where?.publicKey === user1PublicKey || where?.id === user1Id) {
        return { id: user1Id, publicKey: user1PublicKey };
      }
      if (where?.publicKey === user2PublicKey || where?.id === user2Id) {
        return { id: user2Id, publicKey: user2PublicKey };
      }
      return null;
    });
  });

  afterEach(async () => {
    await closeSocket();
  });

  describe('Connection Authentication via JWT Query Param', () => {
    it('authenticates socket connection via JWT query param', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_1', user1Token);

      // Execute middleware registered on io
      const middlewares = (server as any).sockets?._fns || (server as any).of?.('/')?._fns || [];
      const authMiddleware = middlewares[0] || socketAuthMiddleware;
      expect(authMiddleware).toBeDefined();

      let authError: Error | null = null;

      await new Promise<void>((resolve) => {
        authMiddleware(client, (err?: any) => {
          if (err) authError = err;
          resolve();
        });
      });

      expect(authError).toBeNull();
      expect(client.user).toBeDefined();
      expect(client.user.sub).toBe(user1PublicKey);
    });

    it('rejects socket connection when no token is provided', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_no_token');

      const middlewares = (server as any).sockets?._fns || (server as any).of?.('/')?._fns || [];
      const authMiddleware = middlewares[0] || socketAuthMiddleware;
      let authError: Error | null = null;

      await new Promise<void>((resolve) => {
        authMiddleware(client, (err?: any) => {
          authError = err;
          resolve();
        });
      });

      expect(authError).toBeDefined();
      expect(authError!.message).toBe('Authentication required');
    });

    it('rejects socket connection when invalid token is provided', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_invalid', 'invalid.jwt.token');

      const middlewares = (server as any).sockets?._fns || (server as any).of?.('/')?._fns || [];
      const authMiddleware = middlewares[0] || socketAuthMiddleware;
      let authError: Error | null = null;

      await new Promise<void>((resolve) => {
        authMiddleware(client, (err?: any) => {
          authError = err;
          resolve();
        });
      });

      expect(authError).toBeDefined();
      expect(authError!.message).toBe('Invalid token');
    });

    it('authenticates socket connection via auth object fallback', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_auth_obj', undefined, user1Token);

      const middlewares = (server as any).sockets?._fns || (server as any).of?.('/')?._fns || [];
      const authMiddleware = middlewares[0] || socketAuthMiddleware;
      let authError: Error | null = null;

      await new Promise<void>((resolve) => {
        authMiddleware(client, (err?: any) => {
          if (err) authError = err;
          resolve();
        });
      });

      expect(authError).toBeNull();
      expect(client.user.sub).toBe(user1PublicKey);
    });
  });

  describe('User Private Socket.io Room Join', () => {
    it('automatically joins client into user private rooms upon connection', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_user1', user1Token);
      client.user = { sub: user1PublicKey };

      // Trigger connection listener
      const connectionListeners: any[] = server.listeners('connection') as any;
      expect(connectionListeners.length).toBeGreaterThan(0);

      const connectionHandler = connectionListeners[0];
      await connectionHandler(client);

      // Verify user joined private rooms: publicKey and userId
      expect(client.rooms.has(user1PublicKey)).toBe(true);
      expect(client.rooms.has(`user:${user1PublicKey}`)).toBe(true);
      expect(client.rooms.has(user1Id)).toBe(true);
      expect(client.rooms.has(`user:${user1Id}`)).toBe(true);
    });

    it('allows client to join additional room with join event', async () => {
      const httpServer = http.createServer();
      const server = initSocket(httpServer);

      const client = new MockSocketClient('sock_custom_join', user1Token);
      client.user = { sub: user1PublicKey };

      const connectionListeners: any[] = server.listeners('connection') as any;
      const connectionHandler = connectionListeners[0];
      await connectionHandler(client);

      client.trigger('join', 'custom_transaction_room');
      expect(client.rooms.has('custom_transaction_room')).toBe(true);
    });
  });

  describe('Event Emission to Private Room with Expected Payload', () => {
    it('emits transaction:status_update to the user private room with exact payload', () => {
      const mockClientUser1 = new MockSocketClient('sock_1');
      mockClientUser1.join(`user:${user1Id}`);
      mockClientUser1.join(user1Id);

      const mockClientUser2 = new MockSocketClient('sock_2');
      mockClientUser2.join(`user:${user2Id}`);
      mockClientUser2.join(user2Id);

      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      const updatedAt = new Date('2026-10-17T03:00:00.000Z');
      emitTransactionStatusUpdate(user1Id, {
        id: 'tx_abc_123',
        status: 'COMPLETED',
        updated_at: updatedAt,
        stellar_transaction_id: 'stellar_tx_hash_999',
      });

      expect(mockIo.to).toHaveBeenCalledWith(user1Id);
      expect(mockIo.to).toHaveBeenCalledWith(`user:${user1Id}`);
      expect(mockIo.emit).toHaveBeenCalledWith('transaction:status_update', {
        id: 'tx_abc_123',
        status: 'COMPLETED',
        updated_at: updatedAt.toISOString(),
        stellar_transaction_id: 'stellar_tx_hash_999',
      });
    });

    it('formats null stellar_transaction_id when missing', () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      emitTransactionStatusUpdate(user1Id, {
        id: 'tx_pending_1',
        status: 'PENDING',
        updated_at: '2026-10-17T03:00:00.000Z',
      });

      expect(mockIo.emit).toHaveBeenCalledWith('transaction:status_update', {
        id: 'tx_pending_1',
        status: 'PENDING',
        updated_at: '2026-10-17T03:00:00.000Z',
        stellar_transaction_id: null,
      });
    });
  });

  describe('Controller and Service Update Paths Event Emission', () => {
    it('emits event from PATCH /api/transactions/:id/status controller', async () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      const mockTx = {
        id: 'tx_ctrl_1',
        userId: user1Id,
        status: 'COMPLETED',
        updatedAt: new Date('2026-10-17T03:10:00.000Z'),
        stellarTxId: 'stellar_tx_ctrl_hash',
        assetCode: 'USDC',
        amount: '100',
        type: 'DEPOSIT',
      };

      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(mockTx);
      (prisma.transaction.update as jest.Mock).mockResolvedValue(mockTx);

      const res = await request(app)
        .patch('/api/transactions/tx_ctrl_1/status')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockIo.emit).toHaveBeenCalledWith(
        'transaction:status_update',
        expect.objectContaining({
          id: 'tx_ctrl_1',
          status: 'COMPLETED',
          stellar_transaction_id: 'stellar_tx_ctrl_hash',
          updated_at: mockTx.updatedAt.toISOString(),
        })
      );
    });

    it('emits event from sep31Service.updateStatus service update path', async () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      const mockUpdatedTx = {
        id: 'tx_sep31_1',
        userId: user1Id,
        status: 'completed',
        sep31Status: 'completed',
        updatedAt: new Date('2026-10-17T03:15:00.000Z'),
        stellarTxId: 'stellar_sep31_hash',
        amount: '250',
        assetCode: 'USDC',
        type: 'SEP31',
        createdAt: new Date(),
      };

      (prisma.transaction.update as jest.Mock).mockResolvedValue(mockUpdatedTx);

      await sep31Service.updateStatus('tx_sep31_1', 'completed', undefined, {
        stellarTxId: 'stellar_sep31_hash',
      });

      expect(mockIo.emit).toHaveBeenCalledWith(
        'transaction:status_update',
        expect.objectContaining({
          id: 'tx_sep31_1',
          status: 'completed',
          stellar_transaction_id: 'stellar_sep31_hash',
          updated_at: mockUpdatedTx.updatedAt.toISOString(),
        })
      );
    });

    it('emits event from updateTransactionStatusAndNotify path', async () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      const existingTx = {
        id: 'tx_webhook_1',
        userId: user1Id,
        status: 'pending_external',
      };

      const updatedTx = {
        id: 'tx_webhook_1',
        userId: user1Id,
        status: 'completed',
        updatedAt: new Date('2026-10-17T03:20:00.000Z'),
        stellarTxId: 'stellar_webhook_hash',
        user: { publicKey: user1PublicKey },
      };

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existingTx);
      (prisma.transaction.update as jest.Mock).mockResolvedValue(updatedTx);

      await updateTransactionStatusAndNotify({
        prisma: prisma as any,
        transactionId: 'tx_webhook_1',
        nextStatus: 'completed' as any,
      });

      expect(mockIo.emit).toHaveBeenCalledWith(
        'transaction:status_update',
        expect.objectContaining({
          id: 'tx_webhook_1',
          status: 'completed',
          stellar_transaction_id: 'stellar_webhook_hash',
          updated_at: updatedTx.updatedAt.toISOString(),
        })
      );
    });

    it('emits event from TransactionReconcileScheduler.reconcile path', async () => {
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      setIo(mockIo as any);

      const pendingTx = {
        id: 'tx_reconcile_1',
        userId: user1Id,
        stellarTxId: 'hash_reconcile_1',
        status: 'pending_stellar',
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      };

      const updatedTx = {
        ...pendingTx,
        status: 'completed',
        updatedAt: new Date('2026-10-17T03:25:00.000Z'),
      };

      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([pendingTx]);
      (prisma.transaction.update as jest.Mock).mockResolvedValue(updatedTx);

      const mockHorizonServer = {
        transactions: jest.fn().mockReturnValue({
          transaction: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue({ successful: true }),
          }),
        }),
      };
      jest.spyOn(stellarService, 'getHorizonServer').mockReturnValue(mockHorizonServer as any);

      const scheduler = new TransactionReconcileScheduler();
      const count = await scheduler.reconcile();

      expect(count).toBe(1);
      expect(mockIo.emit).toHaveBeenCalledWith(
        'transaction:status_update',
        expect.objectContaining({
          id: 'tx_reconcile_1',
          status: 'completed',
          stellar_transaction_id: 'hash_reconcile_1',
          updated_at: updatedTx.updatedAt.toISOString(),
        })
      );
    });
  });
});
