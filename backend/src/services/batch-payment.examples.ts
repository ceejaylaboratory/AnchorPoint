/**
 * Batch Payment Service - Usage Examples
 * 
 * This file demonstrates various use cases for the batch payment service
 */

import { BatchPaymentService, PaymentOperation } from './batch-payment.index';
import { config } from '../config/env';

// Initialize the service
const batchService = new BatchPaymentService({
  horizonUrl: config.STELLAR_HORIZON_URL,
  networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  maxOperationsPerBatch: 100,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Example 1: Simple batch payment (XLM)
export async function exampleSimpleBatchPayment() {
  const payments: PaymentOperation[] = [
    {
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '10.5',
    },
    {
      destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      amount: '20.0',
    },
    {
      destination: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      amount: '15.75',
    },
  ];

  try {
    const result = await batchService.executeBatch({
      payments,
      sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      baseFee: 100, // 100 stroops per operation
      timeoutInSeconds: 300,
    });

    console.log('✅ Batch payment successful!');
    console.log(`Transaction Hash: ${result.transactionHash}`);
    console.log(`Fee Paid: ${result.feePaid} stroops`);
    console.log(`Operations: ${result.successfulOps}/${result.totalOps}`);
    console.log(`Ledger: ${result.ledger}`);

    return result;
  } catch (error) {
    console.error('❌ Batch payment failed:', error);
    throw error;
  }
}

// Example 2: Batch payment with custom assets (USDC)
export async function exampleAssetBatchPayment() {
  const usdcIssuer = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

  const payments: PaymentOperation[] = [
    {
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '100.0',
      assetCode: 'USDC',
      assetIssuer: usdcIssuer,
    },
    {
      destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      amount: '250.5',
      assetCode: 'USDC',
      assetIssuer: usdcIssuer,
    },
  ];

  try {
    const result = await batchService.executeBatch({
      payments,
      sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });

    console.log('✅ USDC batch payment successful!');
    console.log(`Transaction Hash: ${result.transactionHash}`);

    return result;
  } catch (error) {
    console.error('❌ USDC batch payment failed:', error);
    throw error;
  }
}

// Example 3: Large batch with chunking (250+ payments)
export async function exampleLargeBatchPayment() {
  // Generate 250 payments
  const payments: PaymentOperation[] = Array.from({ length: 250 }, (_, i) => ({
    destination: `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB${i % 10}`,
    amount: (Math.random() * 10 + 1).toFixed(2),
  }));

  try {
    console.log(`📦 Processing ${payments.length} payments in chunks...`);

    const results = await batchService.executeBatchInChunks(
      payments,
      'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      100 // 100 payments per batch
    );

    console.log('✅ All batches processed successfully!');
    console.log(`Total Batches: ${results.length}`);
    console.log(`Total Operations: ${results.reduce((sum, r) => sum + r.totalOps, 0)}`);
    console.log(`Total Fees: ${results.reduce((sum, r) => sum + r.feePaid, 0)} stroops`);

    results.forEach((result, index) => {
      console.log(`Batch ${index + 1}: ${result.transactionHash}`);
    });

    return results;
  } catch (error) {
    console.error('❌ Large batch payment failed:', error);
    throw error;
  }
}

// Example 4: Handle partial failures
export async function exampleHandlePartialFailure() {
  // Simulate failed operations from a previous batch
  const failedPayments: PaymentOperation[] = [
    {
      destination: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
      amount: '50.0',
    },
    {
      destination: 'GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      amount: '75.5',
    },
  ];

  try {
    console.log('🔄 Retrying failed payments...');

    const result = await batchService.handlePartialFailure(
      failedPayments,
      'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    );

    if (result.failed.length === 0) {
      console.log('✅ All failed payments successfully retried!');
      console.log(`Transaction Hash: ${result.transactionHash}`);
    } else {
      console.warn('⚠️ Partial retry failure:');
      console.log(`Succeeded: ${result.successful.length}`);
      console.log(`Failed: ${result.failed.length}`);
      
      result.failed.forEach((failure) => {
        console.error(`  - Operation ${failure.operationIndex}: ${failure.error}`);
      });
    }

    return result;
  } catch (error) {
    console.error('❌ Partial failure handling failed:', error);
    throw error;
  }
}

// Example 5: Mixed asset batch payment
export async function exampleMixedAssetBatch() {
  const usdcIssuer = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

  const payments: PaymentOperation[] = [
    // XLM payments
    {
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '10.0',
      assetCode: 'XLM',
    },
    {
      destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      amount: '20.0',
      // No assetCode = native XLM
    },
    // USDC payments
    {
      destination: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      amount: '100.0',
      assetCode: 'USDC',
      assetIssuer: usdcIssuer,
    },
    // EUR payments
    {
      destination: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
      amount: '50.0',
      assetCode: 'EUR',
      assetIssuer: usdcIssuer,
    },
  ];

  try {
    const result = await batchService.executeBatch({
      payments,
      sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });

    console.log('✅ Mixed asset batch successful!');
    console.log(`Transaction Hash: ${result.transactionHash}`);
    console.log(`Total Operations: ${result.totalOps}`);

    return result;
  } catch (error) {
    console.error('❌ Mixed asset batch failed:', error);
    throw error;
  }
}

// Example 6: API Integration (Express route handler)
export async function exampleAPIIntegration(payments: PaymentOperation[], sourceSecretKey: string) {
  try {
    // Validate input
    if (!payments || payments.length === 0) {
      return {
        success: false,
        error: 'Payments array is required',
      };
    }

    if (payments.length > 100) {
      return {
        success: false,
        error: 'Maximum 100 payments per batch',
      };
    }

    // Execute batch
    const result = await batchService.executeBatch({
      payments,
      sourceSecretKey,
    });

    return {
      success: true,
      data: result,
      message: `Successfully executed ${result.successfulOps} payments`,
    };
  } catch (error) {
    console.error('API batch payment error:', error);
    
    return {
      success: false,
      error: error.message || 'Batch payment failed',
    };
  }
}

// Example 7: Fee comparison calculator
export function calculateFeeSavings(numPayments: number, baseFeePerOp: number = 100) {
  // Individual transactions
  const individualTransactions = numPayments;
  const individualTotalFee = individualTransactions * baseFeePerOp;
  const individualNetworkCalls = numPayments;

  // Batch transaction
  const batchTransactions = Math.ceil(numPayments / 100);
  const batchTotalFee = batchTransactions * numPayments * baseFeePerOp;
  const batchNetworkCalls = batchTransactions;

  // Savings
  const feeSavings = individualTotalFee - batchTotalFee;
  const networkSavings = individualNetworkCalls - batchNetworkCalls;
  const feeSavingsPercentage = ((feeSavings / individualTotalFee) * 100).toFixed(2);
  const networkSavingsPercentage = ((networkSavings / individualNetworkCalls) * 100).toFixed(2);

  console.log('📊 Fee Comparison:');
  console.log(`Payments: ${numPayments}`);
  console.log('');
  console.log('Individual Transactions:');
  console.log(`  - Transactions: ${individualTransactions}`);
  console.log(`  - Total Fee: ${individualTotalFee} stroops`);
  console.log(`  - Network Calls: ${individualNetworkCalls}`);
  console.log('');
  console.log('Batch Transactions:');
  console.log(`  - Transactions: ${batchTransactions}`);
  console.log(`  - Total Fee: ${batchTotalFee} stroops`);
  console.log(`  - Network Calls: ${batchNetworkCalls}`);
  console.log('');
  console.log('Savings:');
  console.log(`  - Fee Reduction: ${feeSavingsPercentage}%`);
  console.log(`  - Network Call Reduction: ${networkSavingsPercentage}%`);

  return {
    individual: {
      transactions: individualTransactions,
      totalFee: individualTotalFee,
      networkCalls: individualNetworkCalls,
    },
    batch: {
      transactions: batchTransactions,
      totalFee: batchTotalFee,
      networkCalls: batchNetworkCalls,
    },
    savings: {
      feeReduction: parseFloat(feeSavingsPercentage),
      networkCallReduction: parseFloat(networkSavingsPercentage),
    },
  };
}

// Example 8: Error handling with specific error types
export async function exampleErrorHandling() {
  const payments: PaymentOperation[] = [
    {
      destination: 'INVALID_ADDRESS',
      amount: '10.0',
    },
  ];

  try {
    await batchService.executeBatch({
      payments,
      sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  } catch (error) {
    if (error.type === 'INVALID_ADDRESS') {
      console.error('❌ Invalid Stellar address provided');
    } else if (error.type === 'EXCEEDS_MAX_OPS') {
      console.error('❌ Too many payments in batch (max 100)');
    } else if (error.type === 'SEQUENCE_CONFLICT') {
      console.error('❌ Sequence number conflict - retry automatically');
    } else if (error.type === 'INSUFFICIENT_BALANCE') {
      console.error('❌ Insufficient balance in source account');
    } else if (error.type === 'NETWORK_ERROR') {
      console.error('❌ Network error - Horizon unavailable');
    } else if (error.type === 'TRANSACTION_FAILED') {
      console.error('❌ Transaction failed - check operation result codes');
    }
    
    throw error;
  }
}

// Example 9: Concurrent batch processing
export async function exampleConcurrentBatches() {
  const batches = [
    [
      { destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', amount: '10.0' },
      { destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', amount: '20.0' },
    ],
    [
      { destination: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', amount: '30.0' },
      { destination: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', amount: '40.0' },
    ],
    [
      { destination: 'GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', amount: '50.0' },
      { destination: 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', amount: '60.0' },
    ],
  ];

  try {
    console.log('🚀 Processing concurrent batches...');

    // Process all batches concurrently
    // Sequence number manager will handle locking automatically
    const results = await Promise.allSettled(
      batches.map((batch, index) => {
        console.log(`Processing batch ${index + 1}...`);
        return batchService.executeBatch({
          payments: batch,
          sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        });
      })
    );

    // Analyze results
    const successful = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);

    return results;
  } catch (error) {
    console.error('❌ Concurrent batch processing failed:', error);
    throw error;
  }
}

// Run examples
async function main() {
  console.log('=== Batch Payment Service Examples ===\n');

  try {
    // Example 1: Simple batch
    console.log('Example 1: Simple Batch Payment');
    await exampleSimpleBatchPayment();
    console.log('\n' + '='.repeat(50) + '\n');

    // Example 7: Fee calculator
    console.log('Example 7: Fee Comparison');
    calculateFeeSavings(50);
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('✅ Examples completed successfully!');
  } catch (error) {
    console.error('❌ Example execution failed:', error);
  }
}

// Uncomment to run examples
// main();
