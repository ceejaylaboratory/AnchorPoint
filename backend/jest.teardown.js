module.exports = async () => {
  console.log('\\nStopping testcontainers...');
  
  if (global.__PG_CONTAINER__) {
    await global.__PG_CONTAINER__.stop();
  }
  
  if (global.__REDIS_CONTAINER__) {
    await global.__REDIS_CONTAINER__.stop();
  }
  
  console.log('Testcontainers stopped.\\n');
};
