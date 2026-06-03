# Soroban Error Handling System

This document describes the Soroban error handling system that captures, categorizes, and maps errors returned by the Soroban host environment during contract calls to human-readable messages for the frontend API.

## Overview

The Soroban error handling system provides:

- **Error Categorization**: Groups similar errors together for better handling
- **Human-Readable Messages**: Maps technical error codes to user-friendly messages
- **Retry Logic**: Determines which errors are retryable
- **Suggested Actions**: Provides actionable suggestions for error resolution
- **Severity Levels**: Classifies errors by impact (LOW, MEDIUM, HIGH, CRITICAL)

## Architecture

### Components

1. **SorobanErrorService** (`backend/src/services/soroban-error.service.ts`)
   - Core service for parsing and categorizing Soroban errors
   - Maps error codes to human-readable messages
   - Determines retry logic and severity levels

2. **Contract Queue Worker** (`backend/src/workers/contract-queue.worker.ts`)
   - Processes contract interaction jobs
   - Uses SorobanErrorService to parse errors
   - Includes error details in job results

3. **Contract Queue Service** (`backend/src/services/contract-queue.service.ts`)
   - Manages job queue and database operations
   - Stores error details in the database
   - Provides error information to the API

4. **Queue Controller** (`backend/src/api/controllers/queue.controller.ts`)
   - Exposes error details via API endpoints
   - Returns formatted error information to the frontend

5. **Database Schema** (`backend/prisma/schema.prisma`)
   - ContractJob model with error detail fields
   - Stores categorized error information

## Error Categories

### Resource-Related Errors
- `RESOURCE_LIMIT`: Operation exceeded resource limits
- `BUDGET_EXCEEDED`: Computational budget exceeded
- `INSUFFICIENT_FEE`: Transaction fee too low

### Storage-Related Errors
- `STORAGE_MISSING`: Required storage entry is missing
- `STORAGE_ARCHIVED`: Required ledger entry has been archived

### Contract Execution Errors
- `CONTRACT_TRAPPED`: Contract execution was trapped
- `CONTRACT_PANIC`: Contract encountered a panic
- `CONTRACT_INVALID`: Contract operation is invalid

### Transaction Validation Errors
- `TRANSACTION_MALFORMED`: Transaction is malformed
- `TRANSACTION_FAILED`: Transaction failed during execution
- `TRANSACTION_BAD_AUTH`: Transaction signature invalid or missing

### Network/RPC Errors
- `NETWORK_ERROR`: Network temporarily unavailable
- `RPC_ERROR`: RPC-related error

### Wasm/VM Errors
- `WASM_VM_ERROR`: WebAssembly VM error
- `WASM_INVALID_ACTION`: Contract attempted invalid operation

### Footprint Errors
- `FOOTPRINT_INVALID`: Footprint is invalid
- `FOOTPRINT_MALFORMED`: Footprint operation is malformed

## Error Severity Levels

- **LOW**: Minor issues that may resolve with retry (e.g., txTOO_EARLY)
- **MEDIUM**: Issues that require user action but are not critical (e.g., INSUFFICIENT_FEE)
- **HIGH**: Serious issues that prevent operation completion (e.g., RESOURCE_LIMIT)
- **CRITICAL**: Critical errors indicating contract or system bugs (e.g., CONTRACT_PANIC)

## API Response Format

When a job fails, the API response includes error details:

```json
{
  "status": "success",
  "data": {
    "job": {
      "id": "uuid",
      "jobId": "queue-job-id",
      "type": "CONTRACT_CALL",
      "status": "FAILED",
      "error": "HostError(Budget, LimitExceeded)",
      "errorDetails": {
        "category": "BUDGET_EXCEEDED",
        "severity": "HIGH",
        "code": "BUDGET_LIMIT_EXCEEDED",
        "userMessage": "The operation exceeded the computational budget. Try reducing the complexity or increasing the fee.",
        "suggestedAction": "Increase resource fee or simplify the operation",
        "retryable": true
      },
      "retryable": true,
      "attempts": 1,
      "maxAttempts": 3,
      "createdAt": "2024-04-25T18:30:00.000Z",
      "failedAt": "2024-04-25T18:30:05.000Z"
    }
  }
}
```

## Usage Examples

### Using SorobanErrorService Directly

```typescript
import sorobanErrorService from '../services/soroban-error.service';

// Parse an error
const error = new Error('HostError(Budget, LimitExceeded)');
const errorDetails = sorobanErrorService.getErrorDetails(error);

console.log(errorDetails);
// {
//   category: 'BUDGET_EXCEEDED',
//   severity: 'HIGH',
//   code: 'BUDGET_LIMIT_EXCEEDED',
//   message: 'HostError(Budget, LimitExceeded)',
//   userMessage: 'The operation exceeded the computational budget...',
//   retryable: true,
//   suggestedAction: 'Increase resource fee or simplify the operation'
// }

// Check if error is retryable
const isRetryable = sorobanErrorService.isRetryable(error);
console.log(isRetryable); // true

// Get user-friendly message for frontend
const userMessage = sorobanErrorService.getUserMessage(error);
console.log(userMessage); // "The operation exceeded the computational budget..."

// Get suggested action
const action = sorobanErrorService.getSuggestedAction(error);
console.log(action); // "Increase resource fee or simplify the operation"

// Format for API response
const apiFormat = sorobanErrorService.formatForApi(error);
console.log(apiFormat);
// {
//   category: 'BUDGET_EXCEEDED',
//   severity: 'HIGH',
//   code: 'BUDGET_LIMIT_EXCEEDED',
//   userMessage: 'The operation exceeded the computational budget...',
//   suggestedAction: 'Increase resource fee or simplify the operation',
//   retryable: true
// }
```

### Adding New Error Mappings

To add a new error mapping, update the `ERROR_MAPPINGS` object in `soroban-error.service.ts`:

```typescript
const ERROR_MAPPINGS: Record<string, SorobanErrorDetails> = {
  // ... existing mappings
  
  'YOUR_NEW_ERROR_CODE': {
    category: SorobanErrorCategory.YOUR_CATEGORY,
    severity: SorobanErrorSeverity.YOUR_SEVERITY,
    code: 'YOUR_ERROR_CODE',
    message: 'Your technical error message',
    userMessage: 'User-friendly explanation of the error',
    retryable: true, // or false
    suggestedAction: 'Action user should take to resolve',
  },
};
```

### Frontend Integration

The frontend can use the error details to display user-friendly messages:

```typescript
// Example frontend component
function JobStatus({ job }: { job: any }) {
  if (job.status === 'FAILED' && job.errorDetails) {
    return (
      <div className="error-message">
        <Alert severity={job.errorDetails.severity.toLowerCase()}>
          <AlertTitle>{job.errorDetails.category}</AlertTitle>
          <p>{job.errorDetails.userMessage}</p>
          {job.errorDetails.retryable && (
            <Button onClick={() => retryJob(job.jobId)}>
              Retry
            </Button>
          )}
          <Typography variant="body2" color="textSecondary">
            Suggested action: {job.errorDetails.suggestedAction}
          </Typography>
        </Alert>
      </div>
    );
  }
  
  // ... other status handling
}
```

## Supported Error Codes

The system currently supports the following Soroban error codes:

### Host Errors
- `HostError(Budget, LimitExceeded)`
- `HostError(Storage, MissingValue)`
- `HostError(WasmVm, InvalidAction)`
- `HostError(<any other code>)`

### Transaction Errors
- `txMALFORMED`
- `txFAILED`
- `txINSUFFICIENT_FEE`
- `txSOROBAN_INVALID`
- `txBAD_AUTH`
- `txTOO_EARLY`

### Operation Errors
- `INVOKE_HOST_FUNCTION_RESOURCE_LIMIT_EXCEEDED`
- `INVOKE_HOST_FUNCTION_INSUFFICIENT_REFUNDABLE_FEE`
- `INVOKE_HOST_FUNCTION_ENTRY_ARCHIVED`
- `INVOKE_HOST_FUNCTION_TRAPPED`
- `RESTORE_FOOTPRINT_MALFORMED`
- `EXTEND_FOOTPRINT_TTL_MALFORMED`

### Contract Errors
- `panic`
- `panic_with_error`

### Network Errors
- `TRY_AGAIN_LATER`

## Database Schema

The `ContractJob` model includes the following error-related fields:

```prisma
model ContractJob {
  error       String?
  errorCategory String?
  errorSeverity String?
  errorCode   String?
  userMessage String?
  suggestedAction String?
  retryable   Boolean     @default(false)
  // ... other fields
}
```

## Testing

To test the error handling system:

1. Create a contract job that will fail
2. Check the job status via API
3. Verify error details are included in the response
4. Test retry logic based on error category

```bash
# Add a job that will fail
curl -X POST http://localhost:3000/api/queue/jobs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CONTRACT_CALL",
    "contractId": "invalid-contract-id",
    "functionName": "some_function"
  }'

# Check job status
curl http://localhost:3000/api/queue/jobs/{jobId} \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Troubleshooting

### Error Details Not Appearing

If error details are not appearing in API responses:

1. Check that the SorobanErrorService is imported in the worker
2. Verify the job failed with a recognized error code
3. Check the database logs for error details storage
4. Ensure the Prisma migration has been run

### Unknown Errors

If an error is categorized as "UNKNOWN":

1. The error code may not be in the ERROR_MAPPINGS
2. Add the error code to the mappings with appropriate categorization
3. Check if the error format matches expected patterns

### Retry Logic Not Working

If retry logic is not working as expected:

1. Verify the `retryable` field is set correctly in the error mapping
2. Check that the worker is using `sorobanErrorService.isRetryable()`
3. Ensure BullMQ retry settings are configured correctly

## Future Enhancements

Potential improvements to the error handling system:

- Add internationalization (i18n) support for user messages
- Implement error analytics and reporting
- Add error rate limiting and alerting
- Create a dashboard for error monitoring
- Add machine learning for error pattern detection
- Support for custom error mappings per contract

## References

- [Stellar Soroban Error Documentation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/errors-and-debugging/debugging-errors)
- [Stellar JS SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [BullMQ Documentation](https://docs.bullmq.io/)
