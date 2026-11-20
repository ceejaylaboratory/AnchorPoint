const { Client } = require('pg');

/**
 * Global Jest teardown.
 *
 * Responsibilities:
 *  1. Truncate all tables in the test database so state does not leak
 *     across test suites (RESTART IDENTITY CASCADE).
 *  2. Close any open database connections cleanly.
 *  3. Stop testcontainers (Postgres / Redis) if they were started.
 */
module.exports = async () => {
  console.log('\nRunning global Jest teardown...');

  // ---------------------------------------------------------------------------
  // 1. Truncate all tables in the test database.
  // ---------------------------------------------------------------------------
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    (global.__PG_CONTAINER__ && global.__PG_CONTAINER__.getConnectionUri
      ? global.__PG_CONTAINER__.getConnectionUri()
      : undefined);

  if (connectionString) {
    let client;
    try {
      client = new Client({ connectionString });
      await client.connect();

      // Collect all base tables in the public schema.
      const { rows } = await client.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      `);

      const tables = rows
        .map((row) => row.tablename)
        .filter((name) => name && name !== 'migrations');

      if (tables.length > 0) {
        const quoted = tables
          .map((name) => `"${name.replace(/"/g, '""')}"`)
          .join(', ');
        await client.query(
          `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`,
        );
        console.log(`Truncated ${tables.length} table(s) in test database.`);
      } else {
        console.log('No tables found to truncate in test database.');
      }
    } catch (err) {
      console.error('Failed to truncate test database tables:', err);
      // Do not re-throw: teardown should still attempt to stop containers.
    } finally {
      if (client) {
        try {
          await client.end();
        } catch (err) {
          console.error('Failed to close test database connection:', err);
        }
      }
    }
  } else {
    console.log('No test database connection string found; skipping truncate.');
  }

  // ---------------------------------------------------------------------------
  // 2. Close any pooled connections that may still be open.
  // ---------------------------------------------------------------------------
  if (global.__PG_POOL__ && typeof global.__PG_POOL__.end === 'function') {
    try {
      await global.__PG_POOL__.end();
      console.log('Closed global Postgres pool.');
    } catch (err) {
      console.error('Failed to close global Postgres pool:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Stop testcontainers.
  // ---------------------------------------------------------------------------
  console.log('\nStopping testcontainers...');

  if (global.__PG_CONTAINER__) {
    try {
      await global.__PG_CONTAINER__.stop();
    } catch (err) {
      console.error('Failed to stop Postgres testcontainer:', err);
    }
  }

  if (global.__REDIS_CONTAINER__) {
    try {
      await global.__REDIS_CONTAINER__.stop();
    } catch (err) {
      console.error('Failed to stop Redis testcontainer:', err);
    }
  }

  console.log('Testcontainers stopped.\n');
};