/**
 * Soroban Error Categories
 * Groups similar errors together for better handling
 */
export enum SorobanErrorCategory {
  // Resource-related errors
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  INSUFFICIENT_FEE = 'INSUFFICIENT_FEE',
  
  // Storage-related errors
  STORAGE_MISSING = 'STORAGE_MISSING',
  STORAGE_ARCHIVED = 'STORAGE_ARCHIVED',
  
  // Contract execution errors
  CONTRACT_TRAPPED = 'CONTRACT_TRAPPED',
  CONTRACT_PANIC = 'CONTRACT_PANIC',
  CONTRACT_INVALID = 'CONTRACT_INVALID',
  
  // Transaction validation errors
  TRANSACTION_MALFORMED = 'TRANSACTION_MALFORMED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_BAD_AUTH = 'TRANSACTION_BAD_AUTH',
  
  // Network/RPC errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  RPC_ERROR = 'RPC_ERROR',
  
  // Wasm/VM errors
  WASM_VM_ERROR = 'WASM_VM_ERROR',
  WASM_INVALID_ACTION = 'WASM_INVALID_ACTION',
  
  // Footprint errors
  FOOTPRINT_INVALID = 'FOOTPRINT_INVALID',
  FOOTPRINT_MALFORMED = 'FOOTPRINT_MALFORMED',
  
  // Unknown errors
  UNKNOWN = 'UNKNOWN',
}

/**
 * Soroban Error Severity
 * Indicates the impact of the error
 */
export enum SorobanErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Soroban Error Details
 * Contains categorized error information
 */
export interface SorobanErrorDetails {
  category: SorobanErrorCategory;
  severity: SorobanErrorSeverity;
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  suggestedAction: string;
}

/**
 * Soroban Error Mapping
 * Maps error codes to human-readable messages
 */
const ERROR_MAPPINGS: Record<string, SorobanErrorDetails> = {
  // Host Errors - Budget
  'HostError(Budget, LimitExceeded)': {
    category: SorobanErrorCategory.BUDGET_EXCEEDED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'BUDGET_LIMIT_EXCEEDED',
    message: 'HostError(Budget, LimitExceeded)',
    userMessage: 'The operation exceeded the computational budget. Try reducing the complexity or increasing the fee.',
    retryable: true,
    suggestedAction: 'Increase resource fee or simplify the operation',
  },

  // Host Errors - Storage
  'HostError(Storage, MissingValue)': {
    category: SorobanErrorCategory.STORAGE_MISSING,
    severity: SorobanErrorSeverity.HIGH,
    code: 'STORAGE_MISSING_VALUE',
    message: 'HostError(Storage, MissingValue)',
    userMessage: 'Required storage entry is missing. The contract may be trying to access non-existent data.',
    retryable: false,
    suggestedAction: 'Verify the contract state and data availability',
  },

  // Host Errors - Wasm VM
  'HostError(WasmVm, InvalidAction)': {
    category: SorobanErrorCategory.WASM_INVALID_ACTION,
    severity: SorobanErrorSeverity.CRITICAL,
    code: 'WASM_INVALID_ACTION',
    message: 'HostError(WasmVm, InvalidAction)',
    userMessage: 'The contract attempted an invalid operation. This may indicate a bug in the contract.',
    retryable: false,
    suggestedAction: 'Contact the contract developer or check contract implementation',
  },

  // Transaction Errors
  'txMALFORMED': {
    category: SorobanErrorCategory.TRANSACTION_MALFORMED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'TX_MALFORMED',
    message: 'txMALFORMED',
    userMessage: 'The transaction is malformed and cannot be processed.',
    retryable: false,
    suggestedAction: 'Check transaction structure and parameters',
  },

  'txFAILED': {
    category: SorobanErrorCategory.TRANSACTION_FAILED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'TX_FAILED',
    message: 'txFAILED',
    userMessage: 'The transaction failed during execution.',
    retryable: true,
    suggestedAction: 'Check operation details and retry',
  },

  'txINSUFFICIENT_FEE': {
    category: SorobanErrorCategory.INSUFFICIENT_FEE,
    severity: SorobanErrorSeverity.MEDIUM,
    code: 'TX_INSUFFICIENT_FEE',
    message: 'txINSUFFICIENT_FEE',
    userMessage: 'The transaction fee is too low. Network congestion may require higher fees.',
    retryable: true,
    suggestedAction: 'Increase the transaction fee and retry',
  },

  'txSOROBAN_INVALID': {
    category: SorobanErrorCategory.CONTRACT_INVALID,
    severity: SorobanErrorSeverity.HIGH,
    code: 'TX_SOROBAN_INVALID',
    message: 'txSOROBAN_INVALID',
    userMessage: 'The Soroban operation is invalid. Check contract parameters and resource limits.',
    retryable: false,
    suggestedAction: 'Review contract invocation parameters and resource limits',
  },

  'txBAD_AUTH': {
    category: SorobanErrorCategory.TRANSACTION_BAD_AUTH,
    severity: SorobanErrorSeverity.HIGH,
    code: 'TX_BAD_AUTH',
    message: 'txBAD_AUTH',
    userMessage: 'The transaction signature is invalid or missing.',
    retryable: false,
    suggestedAction: 'Check transaction signatures and authorization',
  },

  'txTOO_EARLY': {
    category: SorobanErrorCategory.TRANSACTION_FAILED,
    severity: SorobanErrorSeverity.LOW,
    code: 'TX_TOO_EARLY',
    message: 'txTOO_EARLY',
    userMessage: 'The transaction was submitted too early. Wait and retry.',
    retryable: true,
    suggestedAction: 'Wait a moment and retry the transaction',
  },

  // Operation Errors - Invoke Host Function
  'INVOKE_HOST_FUNCTION_RESOURCE_LIMIT_EXCEEDED': {
    category: SorobanErrorCategory.RESOURCE_LIMIT,
    severity: SorobanErrorSeverity.HIGH,
    code: 'INVOKE_RESOURCE_LIMIT_EXCEEDED',
    message: 'INVOKE_HOST_FUNCTION_RESOURCE_LIMIT_EXCEEDED',
    userMessage: 'The contract invocation exceeded resource limits. Increase fees or reduce complexity.',
    retryable: true,
    suggestedAction: 'Increase resource fee or simplify the operation',
  },

  'INVOKE_HOST_FUNCTION_INSUFFICIENT_REFUNDABLE_FEE': {
    category: SorobanErrorCategory.INSUFFICIENT_FEE,
    severity: SorobanErrorSeverity.MEDIUM,
    code: 'INVOKE_INSUFFICIENT_REFUNDABLE_FEE',
    message: 'INVOKE_HOST_FUNCTION_INSUFFICIENT_REFUNDABLE_FEE',
    userMessage: 'Insufficient refundable fee for the operation.',
    retryable: true,
    suggestedAction: 'Increase the refundable fee',
  },

  'INVOKE_HOST_FUNCTION_ENTRY_ARCHIVED': {
    category: SorobanErrorCategory.STORAGE_ARCHIVED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'INVOKE_ENTRY_ARCHIVED',
    message: 'INVOKE_HOST_FUNCTION_ENTRY_ARCHIVED',
    userMessage: 'The required ledger entry has been archived and is not accessible.',
    retryable: false,
    suggestedAction: 'Restore the archived entry or use a different approach',
  },

  'INVOKE_HOST_FUNCTION_TRAPPED': {
    category: SorobanErrorCategory.CONTRACT_TRAPPED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'INVOKE_TRAPPED',
    message: 'INVOKE_HOST_FUNCTION_TRAPPED',
    userMessage: 'The contract execution was trapped. This may be due to a panic or assertion failure.',
    retryable: false,
    suggestedAction: 'Check contract logic and error handling',
  },

  // Footprint Errors
  'RESTORE_FOOTPRINT_MALFORMED': {
    category: SorobanErrorCategory.FOOTPRINT_MALFORMED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'RESTORE_FOOTPRINT_MALFORMED',
    message: 'RESTORE_FOOTPRINT_MALFORMED',
    userMessage: 'The restore footprint operation is malformed.',
    retryable: false,
    suggestedAction: 'Check footprint parameters',
  },

  'EXTEND_FOOTPRINT_TTL_MALFORMED': {
    category: SorobanErrorCategory.FOOTPRINT_MALFORMED,
    severity: SorobanErrorSeverity.HIGH,
    code: 'EXTEND_FOOTPRINT_TTL_MALFORMED',
    message: 'EXTEND_FOOTPRINT_TTL_MALFORMED',
    userMessage: 'The extend footprint TTL operation is malformed.',
    retryable: false,
    suggestedAction: 'Check TTL extension parameters',
  },

  // Network Errors
  'TRY_AGAIN_LATER': {
    category: SorobanErrorCategory.NETWORK_ERROR,
    severity: SorobanErrorSeverity.MEDIUM,
    code: 'TRY_AGAIN_LATER',
    message: 'TRY_AGAIN_LATER',
    userMessage: 'The network is temporarily unavailable. Please try again later.',
    retryable: true,
    suggestedAction: 'Wait and retry the operation',
  },

  // Panic Errors
  'panic': {
    category: SorobanErrorCategory.CONTRACT_PANIC,
    severity: SorobanErrorSeverity.CRITICAL,
    code: 'CONTRACT_PANIC',
    message: 'panic',
    userMessage: 'The contract encountered a panic. This indicates a serious error in contract logic.',
    retryable: false,
    suggestedAction: 'Review contract code and logic',
  },

  'panic_with_error': {
    category: SorobanErrorCategory.CONTRACT_PANIC,
    severity: SorobanErrorSeverity.CRITICAL,
    code: 'CONTRACT_PANIC_WITH_ERROR',
    message: 'panic_with_error',
    userMessage: 'The contract encountered a panic with an error message.',
    retryable: false,
    suggestedAction: 'Review the error message and contract logic',
  },
};

/**
 * Soroban Error Service
 * Captures, categorizes, and maps Soroban errors to human-readable messages
 */
class SorobanErrorService {
  /**
   * Parse and categorize a Soroban error
   */
  parseError(error: any): SorobanErrorDetails {
    const errorMessage = this.extractErrorMessage(error);
    
    // Try to find exact match
    const exactMatch = ERROR_MAPPINGS[errorMessage];
    if (exactMatch) {
      return exactMatch;
    }

    // Try to find partial match
    for (const [key, mapping] of Object.entries(ERROR_MAPPINGS)) {
      if (errorMessage.includes(key)) {
        return mapping;
      }
    }

    // Check for common patterns
    if (errorMessage.includes('HostError')) {
      return this.parseHostError(errorMessage);
    }

    if (errorMessage.includes('tx')) {
      return this.parseTransactionError(errorMessage);
    }

    if (errorMessage.includes('INVOKE_HOST_FUNCTION')) {
      return this.parseInvokeError(errorMessage);
    }

    // Default to unknown
    return {
      category: SorobanErrorCategory.UNKNOWN,
      severity: SorobanErrorSeverity.MEDIUM,
      code: 'UNKNOWN_ERROR',
      message: errorMessage,
      userMessage: 'An unknown error occurred. Please check the error details.',
      retryable: false,
      suggestedAction: 'Contact support with error details',
    };
  }

  /**
   * Extract error message from various error formats
   */
  private extractErrorMessage(error: any): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error?.message) {
      return error.message;
    }

    if (error?.response?.data?.extras?.result_codes) {
      const resultCodes = error.response.data.extras.result_codes;
      if (resultCodes.transaction) {
        return resultCodes.transaction;
      }
      if (resultCodes.operations) {
        return resultCodes.operations[0];
      }
    }

    if (error?.response?.data?.error) {
      return error.response.data.error;
    }

    if (error?.code) {
      return error.code;
    }

    return JSON.stringify(error);
  }

  /**
   * Parse HostError variants
   */
  private parseHostError(errorMessage: string): SorobanErrorDetails {
    if (errorMessage.includes('Budget')) {
      return {
        category: SorobanErrorCategory.BUDGET_EXCEEDED,
        severity: SorobanErrorSeverity.HIGH,
        code: 'HOST_BUDGET_ERROR',
        message: errorMessage,
        userMessage: 'A budget-related error occurred. The operation may be too complex.',
        retryable: true,
        suggestedAction: 'Reduce operation complexity or increase fees',
      };
    }

    if (errorMessage.includes('Storage')) {
      return {
        category: SorobanErrorCategory.STORAGE_MISSING,
        severity: SorobanErrorSeverity.HIGH,
        code: 'HOST_STORAGE_ERROR',
        message: errorMessage,
        userMessage: 'A storage-related error occurred. Required data may be missing.',
        retryable: false,
        suggestedAction: 'Verify contract state and data availability',
      };
    }

    if (errorMessage.includes('WasmVm')) {
      return {
        category: SorobanErrorCategory.WASM_VM_ERROR,
        severity: SorobanErrorSeverity.CRITICAL,
        code: 'HOST_WASM_ERROR',
        message: errorMessage,
        userMessage: 'A WebAssembly VM error occurred. This may indicate a contract bug.',
        retryable: false,
        suggestedAction: 'Contact contract developer',
      };
    }

    return {
      category: SorobanErrorCategory.UNKNOWN,
      severity: SorobanErrorSeverity.MEDIUM,
      code: 'HOST_ERROR',
      message: errorMessage,
      userMessage: 'A host environment error occurred.',
      retryable: false,
      suggestedAction: 'Check error details and retry',
    };
  }

  /**
   * Parse transaction-level errors
   */
  private parseTransactionError(errorMessage: string): SorobanErrorDetails {
    if (errorMessage.includes('INSUFFICIENT_FEE') || errorMessage.includes('insufficient_fee')) {
      return {
        category: SorobanErrorCategory.INSUFFICIENT_FEE,
        severity: SorobanErrorSeverity.MEDIUM,
        code: 'TX_FEE_ERROR',
        message: errorMessage,
        userMessage: 'The transaction fee is insufficient.',
        retryable: true,
        suggestedAction: 'Increase the transaction fee',
      };
    }

    if (errorMessage.includes('BAD_AUTH') || errorMessage.includes('bad_auth')) {
      return {
        category: SorobanErrorCategory.TRANSACTION_BAD_AUTH,
        severity: SorobanErrorSeverity.HIGH,
        code: 'TX_AUTH_ERROR',
        message: errorMessage,
        userMessage: 'Transaction authorization failed.',
        retryable: false,
        suggestedAction: 'Check signatures and authorization',
      };
    }

    return {
      category: SorobanErrorCategory.TRANSACTION_FAILED,
      severity: SorobanErrorSeverity.HIGH,
      code: 'TX_ERROR',
      message: errorMessage,
      userMessage: 'A transaction error occurred.',
      retryable: true,
      suggestedAction: 'Review transaction details and retry',
    };
  }

  /**
   * Parse invoke host function errors
   */
  private parseInvokeError(errorMessage: string): SorobanErrorDetails {
    if (errorMessage.includes('RESOURCE_LIMIT') || errorMessage.includes('resource_limit')) {
      return {
        category: SorobanErrorCategory.RESOURCE_LIMIT,
        severity: SorobanErrorSeverity.HIGH,
        code: 'INVOKE_RESOURCE_ERROR',
        message: errorMessage,
        userMessage: 'The operation exceeded resource limits.',
        retryable: true,
        suggestedAction: 'Increase resource fee or reduce complexity',
      };
    }

    if (errorMessage.includes('TRAPPED') || errorMessage.includes('trapped')) {
      return {
        category: SorobanErrorCategory.CONTRACT_TRAPPED,
        severity: SorobanErrorSeverity.HIGH,
        code: 'INVOKE_TRAPPED_ERROR',
        message: errorMessage,
        userMessage: 'The contract execution was trapped.',
        retryable: false,
        suggestedAction: 'Check contract logic',
      };
    }

    return {
      category: SorobanErrorCategory.CONTRACT_INVALID,
      severity: SorobanErrorSeverity.HIGH,
      code: 'INVOKE_ERROR',
      message: errorMessage,
      userMessage: 'A contract invocation error occurred.',
      retryable: false,
      suggestedAction: 'Review contract parameters',
    };
  }

  /**
   * Check if an error is retryable based on its category
   */
  isRetryable(error: any): boolean {
    const errorDetails = this.parseError(error);
    return errorDetails.retryable;
  }

  /**
   * Get user-friendly error message for frontend
   */
  getUserMessage(error: any): string {
    const errorDetails = this.parseError(error);
    return errorDetails.userMessage;
  }

  /**
   * Get suggested action for error resolution
   */
  getSuggestedAction(error: any): string {
    const errorDetails = this.parseError(error);
    return errorDetails.suggestedAction;
  }

  /**
   * Get complete error details for logging/debugging
   */
  getErrorDetails(error: any): SorobanErrorDetails {
    return this.parseError(error);
  }

  /**
   * Format error for API response
   */
  formatForApi(error: any): {
    category: SorobanErrorCategory;
    severity: SorobanErrorSeverity;
    code: string;
    userMessage: string;
    suggestedAction: string;
    retryable: boolean;
  } {
    const details = this.parseError(error);
    return {
      category: details.category,
      severity: details.severity,
      code: details.code,
      userMessage: details.userMessage,
      suggestedAction: details.suggestedAction,
      retryable: details.retryable,
    };
  }
}

export default new SorobanErrorService();
