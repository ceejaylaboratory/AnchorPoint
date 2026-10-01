const { execSync } = require('child_process');

module.exports = async () => {
  console.log('\\nStarting testcontainers...');
  
  try {
    const { PostgreSqlContainer } = require('@testcontainers/postgresql');
    const { RedisContainer } = require('@testcontainers/redis');

    // Start Postgres
    const pgContainer = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('testdb')
      .withUsername('testuser')
      .withPassword('testpass')
      .start();
      
    // Start Redis
    const redisContainer = await new RedisContainer('redis:7-alpine').start();

    const databaseUrl = pgContainer.getConnectionUri();
    const redisUrl = redisContainer.getConnectionUrl();

    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    
    // Save containers to global so teardown can stop them
    global.__PG_CONTAINER__ = pgContainer;
    global.__REDIS_CONTAINER__ = redisContainer;

    console.log('Running Prisma migrations on test database...');
    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    });
    console.log('Migrations complete.\\n');
  } catch (error) {
    console.warn('\\nWarning: Testcontainers could not be started (Docker daemon may not be running). Skipping container setup.', error.message);
  }
};

