import logger from '../utils/logger';

export interface ServerStartedPayload {
  event: 'server_started';
  commit: string;
  environment: string;
  timestamp: string;
}

export function buildServerStartedPayload(): ServerStartedPayload {
  return {
    event: 'server_started',
    commit: process.env.GIT_SHA || process.env.COMMIT_SHA || 'unknown',
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  };
}

export function formatNotifyBody(url: string, payload: ServerStartedPayload): Record<string, unknown> {
  const text = `Server started: ${payload.event} commit=${payload.commit} env=${payload.environment} at ${payload.timestamp}`;
  if (url.includes('discord.com/api/webhooks')) {
    return { content: text };
  }
  if (url.includes('hooks.slack.com')) {
    return { text };
  }
  return { ...payload };
}

export async function notifyServerStarted(): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    return;
  }
  const payload = buildServerStartedPayload();
  const body = formatNotifyBody(url, payload);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    logger.info('Server startup notification sent');
  } catch (err) {
    logger.warn('Failed to send server startup notification', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
