/** Read operations that hide soft-deleted rows unless the caller filters on `deletedAt` itself. */
export const SOFT_DELETE_READ_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
] as const;

/**
 * Adds `deletedAt: null` to a query's `where` clause unless the caller already
 * filters on `deletedAt` (e.g. the retention purge job looking up old rows).
 */
type QueryArgs = { where?: Record<string, unknown> };

export function excludeSoftDeleted<T extends QueryArgs>(args: T): T {
  const where = args?.where ?? {};
  if ('deletedAt' in where) {
    return args;
  }
  return { ...args, where: { ...where, deletedAt: null } };
}

/**
 * Prisma client extension (passed to `$extends`) that filters soft-deleted KYC
 * customer records out of default read queries (#1197).
 */
export const softDeleteExtension = {
  name: 'soft-delete',
  query: {
    kycCustomer: {
      async $allOperations({
        operation,
        args,
        query,
      }: {
        operation: string;
        args: QueryArgs;
        query: (args: QueryArgs) => Promise<unknown>;
      }) {
        if ((SOFT_DELETE_READ_OPERATIONS as readonly string[]).includes(operation)) {
          return query(excludeSoftDeleted(args));
        }
        return query(args);
      },
    },
  },
};
