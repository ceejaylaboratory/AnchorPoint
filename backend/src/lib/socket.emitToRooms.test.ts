import { emitToRooms } from '../lib/socket';
import { EventEmitter } from 'events';

describe('Socket.IO emitToRooms', () => {
  let mockIo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('should broadcast to multiple rooms with error isolation', () => {
    const { setIo } = require('../lib/socket');
    
    const mockAdapter = new Map([
      ['room1', new Set(['socket1'])],
      ['room2', new Set(['socket2'])],
    ]);
    
    mockIo = { 
      sockets: { adapter: mockAdapter },
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    setIo(mockIo);

    const result = emitToRooms(['room1', 'room2'], 'test_event', { data: 'test' });

    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle empty rooms gracefully', () => {
    const { setIo } = require('../lib/socket');
    
    const mockAdapter = new Map([
      ['room1', new Set()], // Empty room
    ]);
    
    mockIo = { 
      sockets: { adapter: mockAdapter },
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    setIo(mockIo);

    const result = emitToRooms(['room1'], 'test_event', { data: 'test' });

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('should return error when io is null', () => {
    const { setIo } = require('../lib/socket');
    setIo(null);

    const result = emitToRooms(['room1'], 'test_event', { data: 'test' });

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('not initialized');
  });

  it('should continue processing remaining rooms on error', () => {
    const { setIo } = require('../lib/socket');
    
    const mockAdapter = new Map([
      ['room1', new Set(['socket1'])],
      ['room2', new Set(['socket2'])],
    ]);
    
    let emitCallCount = 0;
    mockIo = { 
      sockets: { adapter: mockAdapter },
      to: jest.fn().mockImplementation(function() {
        return {
          emit: () => {
            emitCallCount++;
            if (emitCallCount === 1) throw new Error('Socket error');
          },
        };
      }),
    };
    setIo(mockIo);

    const result = emitToRooms(['room1', 'room2'], 'test_event', { data: 'test' });

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});