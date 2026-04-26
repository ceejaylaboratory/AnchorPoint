#!/usr/bin/env ts-node

import { Worker, Job } from 'bullmq';
import * as StellarSdk from '@stellar/stellar-sdk';
import logger from '../utils/logger';
import { defaultWorkerOptions, QUEUE_NAMES, retryStrategies } from '../config/queue';
import { ContractJobData, JobResult } from '../services/contract-queue.service';
import sorobanErrorService from '../services/soroban-error.service';

/**
 * Contract Queue Worker
 * Processes jobs from the contract interactions queue
 */

// Stellar server instance
const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

/**
 * Process a contract call job
 */
async function processContractCall(job: Job<ContractJobData>): Promise<JobResult> {
  const { contractId, functionName, parameters } = job.data;

  logger.info(`Processing contract call: ${contractId}.${functionName}`);

  try {
    // Update progress
    await job.updateProgress(10);

    // Simulate contract interaction
    // In a real implementation, this would use Stellar SDK to interact with the contract
    
    // Example: Build and submit contract invocation
    // const contract = new StellarSdk.Contract(contractId);
    // const operation = contract.call(functionName, ...Object.values(parameters));
    
    await job.updateProgress(50);

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000));

    await job.updateProgress(90);

    // Return success result
    const result: JobResult = {
      success: true,
      data: {
        contractId,
        functionName,
        parameters,
        executedAt: new Date(),
      },
      timestamp: new Date(),
    };

    await job.updateProgress(100);

    logger.info(`Contract call completed: ${job.id}`);
    return result;
  } catch (error: any) {
    logger.error(`Contract call failed: ${job.id}`, error);
    
    // Parse error using Soroban error service
    const errorDetails = sorobanErrorService.getErrorDetails(error);
    logger.error(`Error details for job ${job.id}:`, errorDetails);
    
    // Check if error is retryable
    if (sorobanErrorService.isRetryable(error)) {
      throw error; // Will be retried by BullMQ
    }

    return {
      success: false,
      error: error.message,
      errorDetails: sorobanErrorService.formatForApi(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Process a contract deployment job
 */
async function processContractDeploy(job: Job<ContractJobData>): Promise<JobResult> {
  const { parameters } = job.data;

  logger.info(`Processing contract deployment: ${job.id}`);

  try {
    await job.updateProgress(10);

    // Simulate contract deployment
    // In a real implementation, this would deploy a contract to Stellar
    
    await job.updateProgress(50);

    await new Promise(resolve => setTimeout(resolve, 3000));

    await job.updateProgress(90);

    const result: JobResult = {
      success: true,
      data: {
        contractId: `CONTRACT_${Date.now()}`,
        deployedAt: new Date(),
        parameters,
      },
      timestamp: new Date(),
    };

    await job.updateProgress(100);

    logger.info(`Contract deployment completed: ${job.id}`);
    return result;
  } catch (error: any) {
    logger.error(`Contract deployment failed: ${job.id}`, error);
    
    // Parse error using Soroban error service
    const errorDetails = sorobanErrorService.getErrorDetails(error);
    logger.error(`Error details for job ${job.id}:`, errorDetails);
    
    if (sorobanErrorService.isRetryable(error)) {
      throw error;
    }

    return {
      success: false,
      error: error.message,
      errorDetails: sorobanErrorService.formatForApi(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Process a settlement job (high priority)
 */
async function processSettlement(job: Job<ContractJobData>): Promise<JobResult> {
  const { contractId, functionName, parameters } = job.data;

  logger.info(`Processing URGENT settlement: ${contractId}.${functionName}`);

  try {
    await job.updateProgress(10);

    // Settlement operations are critical and should be processed quickly
    // Implement actual settlement logic here
    
    await job.updateProgress(30);

    // Example: Execute settlement transaction
    // const result = await executeSettlementTransaction(contractId, functionName, parameters);

    await job.updateProgress(70);

    await new Promise(resolve => setTimeout(resolve, 1500));

    await job.updateProgress(95);

    const result: JobResult = {
      success: true,
      data: {
        contractId,
        functionName,
        parameters,
        settlementId: `SETTLE_${Date.now()}`,
        executedAt: new Date(),
      },
      timestamp: new Date(),
    };

    await job.updateProgress(100);

    logger.info(`Settlement completed: ${job.id}`);
    return result;
  } catch (error: any) {
    logger.error(`Settlement failed: ${job.id}`, error);
    
    // Parse error using Soroban error service
    const errorDetails = sorobanErrorService.getErrorDetails(error);
    logger.error(`Error details for job ${job.id}:`, errorDetails);
    
    // Settlements should be retried aggressively
    if (sorobanErrorService.isRetryable(error)) {
      throw error;
    }

    return {
      success: false,
      error: error.message,
      errorDetails: sorobanErrorService.formatForApi(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Process a transaction submission job
 */
async function processTransactionSubmit(job: Job<ContractJobData>): Promise<JobResult> {
  const { parameters } = job.data;

  logger.info(`Processing transaction submission: ${job.id}`);

  try {
    await job.updateProgress(10);

    const { envelopeXdr } = parameters;

    if (!envelopeXdr) {
      throw new Error('Missing transaction envelope XDR');
    }

    // Parse and submit transaction
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      envelopeXdr,
      StellarSdk.Networks.TESTNET
    );

    await job.updateProgress(30);

    // Submit to Stellar network
    const response = await server.submitTransaction(transaction as StellarSdk.Transaction);

    await job.updateProgress(90);

    const result: JobResult = {
      success: true,
      data: {
        transactionId: response.hash,
        ledger: response.ledger,
        envelope: response.envelope_xdr,
      },
      transactionId: response.hash,
      timestamp: new Date(),
    };

    await job.updateProgress(100);

    logger.info(`Transaction submitted: ${response.hash}`);
    return result;
  } catch (error: any) {
    logger.error(`Transaction submission failed: ${job.id}`, error);
    
    // Parse error using Soroban error service
    const errorDetails = sorobanErrorService.getErrorDetails(error);
    logger.error(`Error details for job ${job.id}:`, errorDetails);
    
    // Check for specific Stellar errors
    if (error.response?.data?.extras?.result_codes) {
      const resultCodes = error.response.data.extras.result_codes;
      logger.error('Stellar error codes:', resultCodes);
    }

    if (sorobanErrorService.isRetryable(error)) {
      throw error;
    }

    return {
      success: false,
      error: error.message,
      errorDetails: sorobanErrorService.formatForApi(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Process a batch operation job
 */
async function processBatchOperation(job: Job<ContractJobData>): Promise<JobResult> {
  const { parameters } = job.data;

  logger.info(`Processing batch operation: ${job.id}`);

  try {
    const { operations } = parameters;

    if (!Array.isArray(operations)) {
      throw new Error('Invalid batch operations');
    }

    const results = [];
    const total = operations.length;

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      
      // Process each operation
      // In a real implementation, this would execute each operation
      await new Promise(resolve => setTimeout(resolve, 500));
      
      results.push({
        index: i,
        operation,
        success: true,
      });

      // Update progress
      await job.updateProgress(Math.floor(((i + 1) / total) * 100));
    }

    const result: JobResult = {
      success: true,
      data: {
        totalOperations: total,
        successfulOperations: results.filter(r => r.success).length,
        results,
      },
      timestamp: new Date(),
    };

    logger.info(`Batch operation completed: ${job.id}`);
    return result;
  } catch (error: any) {
    logger.error(`Batch operation failed: ${job.id}`, error);
    
    // Parse error using Soroban error service
    const errorDetails = sorobanErrorService.getErrorDetails(error);
    logger.error(`Error details for job ${job.id}:`, errorDetails);
    
    return {
      success: false,
      error: error.message,
      errorDetails: sorobanErrorService.formatForApi(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Main job processor
 */
async function processJob(job: Job<ContractJobData>): Promise<JobResult> {
  logger.info(`Processing job ${job.id} of type ${job.data.type}`);

  try {
    // Route to appropriate handler based on job type
    switch (job.data.type) {
      case 'CONTRACT_CALL':
        return await processContractCall(job);
      
      case 'CONTRACT_DEPLOY':
        return await processContractDeploy(job);
      
      case 'SETTLEMENT':
        return await processSettlement(job);
      
      case 'TRANSACTION_SUBMIT':
        return await processTransactionSubmit(job);
      
      case 'BATCH_OPERATION':
        return await processBatchOperation(job);
      
      default:
        throw new Error(`Unknown job type: ${job.data.type}`);
    }
  } catch (error: any) {
    logger.error(`Job ${job.id} processing error:`, error);
    throw error;
  }
}

/**
 * Custom retry strategy based on error type
 */
function getRetryDelay(attemptsMade: number, error: any): number {
  const errorMessage = error.message?.toLowerCase() || '';

  // Check for specific error types
  for (const [errorType, strategy] of Object.entries(retryStrategies)) {
    if (errorMessage.includes(errorType.toLowerCase())) {
      const delay = strategy.delay * Math.pow(strategy.backoffMultiplier, attemptsMade - 1);
      logger.info(`Retry delay for ${errorType}: ${delay}ms (attempt ${attemptsMade})`);
      return delay;
    }
  }

  // Default exponential backoff
  return Math.min(1000 * Math.pow(2, attemptsMade - 1), 30000);
}

/**
 * Create and start the worker
 */
function startWorker() {
  const worker = new Worker(
    QUEUE_NAMES.CONTRACT_INTERACTIONS,
    processJob,
    {
      ...defaultWorkerOptions,
      settings: {
        backoffStrategy: (attemptsMade: number, type: string, error: Error) => {
          return getRetryDelay(attemptsMade, error);
        },
      },
    }
  );

  // Worker event listeners
  worker.on('completed', (job: Job, result: JobResult) => {
    logger.info(`✅ Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (job) {
      logger.error(`❌ Job ${job.id} failed after ${job.attemptsMade} attempts:`, error.message);
    }
  });

  worker.on('error', (error: Error) => {
    logger.error('Worker error:', error);
  });

  worker.on('stalled', (jobId: string) => {
    logger.warn(`Job ${jobId} stalled`);
  });

  logger.info('🚀 Contract queue worker started');
  logger.info(`   Queue: ${QUEUE_NAMES.CONTRACT_INTERACTIONS}`);
  logger.info(`   Concurrency: ${defaultWorkerOptions.concurrency}`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing worker...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing worker...');
    await worker.close();
    process.exit(0);
  });

  return worker;
}

// Start the worker if this file is run directly
if (require.main === module) {
  startWorker();
}

export { startWorker, processJob };
