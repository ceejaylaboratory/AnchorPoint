import HorizonEventMonitor from './horizonEventMonitor';

// Example usage
const monitor = new HorizonEventMonitor({
  horizonUrl: 'https://horizon.stellar.org',
  pollIntervalMs: 5000,
});

monitor.addSubscription({
  id: 'sub1',
  account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  webhookUrl: 'https://your-webhook-url.com',
  filter: (event) => event.asset_type === 'credit_alphanum4' && event.asset_code === 'USDC',
});

monitor.on('webhook_failed', ({ sub, event, error }: { sub: any, event: any, error: any }) => {
  console.error('Webhook delivery failed', sub, event, error);
});

monitor.start();
