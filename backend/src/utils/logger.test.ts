import logger from './logger';

describe('Logger', () => {
  it('should log info messages', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
  });

  it('should log error messages', () => {
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  it('should log warning messages', () => {
    expect(() => logger.warn('Test warning message')).not.toThrow();
  });

  it('should log debug messages', () => {
    expect(() => logger.debug('Test debug message')).not.toThrow();
  });

  it('should log error with stack trace', () => {
    const error = new Error('Test error');
    expect(() => logger.error(error)).not.toThrow();
  });
});
