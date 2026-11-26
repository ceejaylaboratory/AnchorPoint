let mockConnectionHandler: ((socket: any) => Promise<void> | void) | null = null;
const mockUse = jest.fn();
const mockClose = jest.fn();

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({
    use: mockUse,
    on: jest.fn((event: string, cb: (socket: any) => Promise<void> | void) => {
      if (event === 'connection') mockConnectionHandler = cb;
    }),
    close: mockClose,
  })),
}));

jest.mock('../services/auth.service', () => ({
  verifyToken: jest.fn(),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    incrementWebSocketConnections: jest.fn(),
    decrementWebSocketConnections: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { initSocket } from './socket';
import prisma from '../lib/prisma';
import { metricsService } from '../services/metrics.service';

const makeSocket = () => {
  const handlers = new Map<string, () => void>();
  const rooms = new Set(['sock_1']);
  return {
    id: 'sock_1',
    connected: true,
    rooms,
    user: { sub: 'GUSER' },
    join: jest.fn((room: string) => rooms.add(room)),
    leave: jest.fn((room: string) => rooms.delete(room)),
    removeAllListeners: jest.fn(),
    on: jest.fn((event: string, cb: () => void) => handlers.set(event, cb)),
    trigger: (event: string) => handlers.get(event)?.(),
  };
};

describe('socket disconnect cleanup (#1581)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionHandler = null;
  });

  it('leaves rooms, removes listeners and decrements the gauge on disconnect', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: 'user_1',
      publicKey: 'GUSER',
    });
    initSocket({} as any);
    expect(mockConnectionHandler).not.toBeNull();

    const socket = makeSocket();
    await mockConnectionHandler!(socket);
    expect(socket.join).toHaveBeenCalledWith('GUSER');
    expect(socket.join).toHaveBeenCalledWith('user_1');

    socket.connected = false;
    const roomCount = socket.rooms.size;
    socket.trigger('disconnect');

    expect(socket.leave).toHaveBeenCalledTimes(roomCount);
    expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(metricsService.decrementWebSocketConnections).toHaveBeenCalledTimes(1);
    expect(socket.rooms.size).toBe(0);
  });

  it('does not join rooms resolved after the client has disconnected', async () => {
    let resolveUser: (value: any) => void = () => undefined;
    (prisma.user.findFirst as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveUser = resolve;
      })
    );
    initSocket({} as any);

    const socket = makeSocket();
    const pending = mockConnectionHandler!(socket);
    socket.connected = false;
    socket.trigger('disconnect');
    resolveUser({ id: 'user_1', publicKey: 'GUSER' });
    await pending;

    expect(socket.join).not.toHaveBeenCalledWith('user_1');
    expect(metricsService.decrementWebSocketConnections).toHaveBeenCalledTimes(1);
  });
});
