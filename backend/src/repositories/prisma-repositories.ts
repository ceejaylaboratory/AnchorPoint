import prisma from '../lib/prisma';
import { PrismaCustomerRepository, type CustomerDelegate } from './customer.repository';
import { PrismaMigrationRepository } from './migration.repository';
import { PrismaQuoteRepository, type QuoteDelegate } from './quote.repository';
import { PrismaTransactionRepository, type TransactionDelegate } from './transaction.repository';
import type { RawQueryClient } from './types';

/**
 * Wiring layer between the Prisma singleton and the typed repositories.
 * Keeping the import here lets services and unit tests depend only on the
 * repository interfaces.
 */
export const createTransactionRepository = (): PrismaTransactionRepository =>
  new PrismaTransactionRepository(prisma.transaction as unknown as TransactionDelegate);

export const createCustomerRepository = (): PrismaCustomerRepository =>
  new PrismaCustomerRepository(prisma.kycCustomer as unknown as CustomerDelegate);

export const createQuoteRepository = (): PrismaQuoteRepository =>
  new PrismaQuoteRepository(prisma.quote as unknown as QuoteDelegate);

export const createMigrationRepository = (): PrismaMigrationRepository =>
  new PrismaMigrationRepository(prisma as unknown as RawQueryClient);
