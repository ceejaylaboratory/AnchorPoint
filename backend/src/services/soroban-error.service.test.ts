import { describe, it, expect } from 'vitest';
import sorobanErrorService from './soroban-error.service';
import { SorobanContractErrorCode } from './soroban-error.service';

// ---------------------------------------------------------------------------
// extractContractErrorCode
// ---------------------------------------------------------------------------
describe('extractContractErrorCode', () => {
  it('extracts Unauthorized (1) from Error(Contract, #1)', () => {
    expect(sorobanErrorService.extractContractErrorCode('Error(Contract, #1)')).toBe(
      SorobanContractErrorCode.Unauthorized
    );
  });

  it('extracts InvalidAmount (3) from Error(Contract, #3)', () => {
    expect(sorobanErrorService.extractContractErrorCode('Error(Contract, #3)')).toBe(
      SorobanContractErrorCode.InvalidAmount
    );
  });

  it('extracts InsufficientBalance (4) from Error(Contract, #4)', () => {
    expect(sorobanErrorService.extractContractErrorCode('Error(Contract, #4)')).toBe(
      SorobanContractErrorCode.InsufficientBalance
    );
  });

  it('extracts ContractPaused (7) from Error(Contract, #7)', () => {
    expect(sorobanErrorService.extractContractErrorCode('Error(Contract, #7)')).toBe(
      SorobanContractErrorCode.ContractPaused
    );
  });

  it('returns undefined for non-contract errors', () => {
    expect(sorobanErrorService.extractContractErrorCode('txFAILED')).toBeUndefined();
    expect(sorobanErrorService.extractContractErrorCode('HostError(Budget, LimitExceeded)')).toBeUndefined();
  });

  it('returns undefined for unknown contract error codes', () => {
    // Code 99 is not defined in the enum
    expect(sorobanErrorService.extractContractErrorCode('Error(Contract, #99)')).toBeUndefined();
  });

  it('extracts code from Error object with message property', () => {
    const err = new Error('simulation failed: Error(Contract, #1)');
    expect(sorobanErrorService.extractContractErrorCode(err)).toBe(SorobanContractErrorCode.Unauthorized);
  });
});

// ---------------------------------------------------------------------------
// httpStatusForError — contract errors
// ---------------------------------------------------------------------------
describe('httpStatusForError — contract error codes', () => {
  const cases: Array<[string, number]> = [
    ['Error(Contract, #0)', 500], // GenericError
    ['Error(Contract, #1)', 403], // Unauthorized
    ['Error(Contract, #2)', 404], // NotFound
    ['Error(Contract, #3)', 400], // InvalidAmount
    ['Error(Contract, #4)', 422], // InsufficientBalance
    ['Error(Contract, #5)', 400], // Overflow
    ['Error(Contract, #6)', 409], // AlreadyExists
    ['Error(Contract, #7)', 503], // ContractPaused
  ];

  it.each(cases)('%s → HTTP %i', (errorStr, expectedStatus) => {
    expect(sorobanErrorService.httpStatusForError(errorStr)).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// httpStatusForError — infrastructure errors must not become 4xx
// ---------------------------------------------------------------------------
describe('httpStatusForError — infrastructure errors', () => {
  it('returns 500 for unknown / unrecognised errors', () => {
    expect(sorobanErrorService.httpStatusForError('some_completely_unknown_error_xyz')).toBe(500);
  });

  it('returns 400 for txBAD_AUTH', () => {
    // Bad auth is a client-originating problem
    expect(sorobanErrorService.httpStatusForError('txBAD_AUTH')).toBe(403);
  });

  it('returns 400 for txINSUFFICIENT_FEE', () => {
    expect(sorobanErrorService.httpStatusForError('txINSUFFICIENT_FEE')).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// toProblemDetail — shape and content
// ---------------------------------------------------------------------------
describe('toProblemDetail', () => {
  it('returns RFC 7807 shape for contract error', () => {
    const problem = sorobanErrorService.toProblemDetail('Error(Contract, #3)');
    expect(problem).toMatchObject({
      type: expect.stringContaining('invalid-amount'),
      title: 'Bad Request',
      status: 400,
      contractErrorCode: 'InvalidAmount',
      retryable: false,
    });
    expect(typeof problem.detail).toBe('string');
    expect(problem.detail.length).toBeGreaterThan(0);
  });

  it('marks ContractPaused as retryable', () => {
    const problem = sorobanErrorService.toProblemDetail('Error(Contract, #7)');
    expect(problem.status).toBe(503);
    expect(problem.retryable).toBe(true);
  });

  it('returns generic internal-error for unknown errors without leaking details', () => {
    const problem = sorobanErrorService.toProblemDetail('something_internal_xyz');
    expect(problem.status).toBe(500);
    expect(problem.type).toContain('internal-error');
    expect(problem.contractErrorCode).toBeUndefined();
    // Must not contain raw error string in the detail
    expect(problem.detail).not.toContain('something_internal_xyz');
  });

  it('omits contractErrorCode for infrastructure errors', () => {
    const problem = sorobanErrorService.toProblemDetail('txFAILED');
    expect(problem.contractErrorCode).toBeUndefined();
  });

  it('includes contractErrorCode for all defined contract error codes', () => {
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const problem = sorobanErrorService.toProblemDetail(`Error(Contract, #${code})`);
      expect(problem.contractErrorCode).toBe(SorobanContractErrorCode[code as SorobanContractErrorCode]);
    }
  });
});
