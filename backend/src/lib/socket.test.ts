import { emitTransactionStatusUpdate, emitTxUpdated, safeEmit } from '../lib/socket';
import { Server as SocketServer, Socket } from 'socket.io';
import { EventEmitter } from 'events';

// Mock Socket.IO
jest.mock('socket.io', () => {
  const mockSocket = new EventEmitter();
  mockSocket.to = jest.fn().mockReturnThis();
  mockSocket.emit = jest.fn();
  return {
    Server: jest.fn().mockImplementation(() => mockSocket),
  };
});

describe('Socket.IO Error Handling', () => {
  let mockIo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module state
    jest.resetModules();
  });

  describe('emitTransactionStatusUpdate', () => {
    it('should broadcast to single room without crashing', () => {
      const { setIo } = require('../lib/socket');
      const mockEmit = jest.fn();
      mockIo = { to: () => ({ emit: mockEmit }) };
      setIo(mockIo);

      expect(() => {
        emitTransactionStatusUpdate('user123', {
          id: 'tx123',
          status: 'completed',
          updated_at: new Date().toISOString(),
          stellar_transaction_id: 'stellar123',
        });
      }).not.toThrow();
    });

    it('should broadcast to multiple rooms without crashing', () => {
      const { setIo } = require('../lib/socket');
      const mockEmit = jest.fn();
      mockIo = { to: () => ({ emit: mockEmit }) };
      setIo(mockIo);

      expect(() => {
        emitTransactionStatusUpdate(['user123', 'user456'], {
          id: 'tx123',
          status: 'pending',
          updated_at: new Date().toISOString(),
        });
      }).not.toThrow();
    });

    it('should handle null io gracefully', () => {
      const { setIo } = require('../lib/socket');
      setIo(null);

      expect(() => {
        emitTransactionStatusUpdate('user123', {
          id: 'tx123',
          status: 'completed',
          updated_at: new Date().toISOString(),
        });
      }).not.toThrow();
    });
  });

  describe('emitTxUpdated', () => {
    it('should emit to all sockets without crashing', () => {
      const { setIo } = require('../lib/socket');
      const mockEmit = jest.fn();
      mockIo = { emit: mockEmit };
      setIo(mockIo);

      expect(() => {
        emitTxUpdated({ id: 'tx123', status: 'completed' });
      }).not.toThrow();
    });

    it('should handle null io gracefully', () => {
      const { setIo } = require('../lib/socket');
      setIo(null);

      expect(() => {
        emitTxUpdated({ id: 'tx123', status: 'pending' });
      }).not.toThrow();
    });
  });

  describe('safeEmit', () => {
    it('should return success when emit succeeds', async () => {
      const { setIo } = require('../lib/socket');
      const mockEmit = jest.fn().mockImplementation(() => {});
      mockIo = { to: () => ({ emit: mockEmit }), sockets: { adapter: { rooms: new Map([['room1', new Set()]]) } } };
      setIo(mockIo);

      const result = await safeEmit('room1', 'event', { data: 'test' });
      expect(result.success).toBe(true);
    });

    it('should return error when io is null', async () => {
      const { setIo } = require('../lib/socket');
      setIo(null);

      const result = await safeEmit('room1', 'event', { data: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Socket.IO server not initialized');
    });

    it('should return error when room does not exist', async () => {
      const { setIo } = require('../lib/socket');
      const mockAdapter = { rooms: new Map() };
      mockIo = { to: () => ({ emit: jest.fn() }), sockets: { adapter: mockAdapter } };
      setIo(mockIo);

      const result = await safeEmit('nonexistent', 'event', { data: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Room does not exist');
    });
  });
});