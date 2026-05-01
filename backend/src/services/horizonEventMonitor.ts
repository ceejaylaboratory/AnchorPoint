// Service: Horizon Event Monitor and Webhook System
// Description: Monitors Stellar Horizon API for account events, manages durable subscriptions, retries failed webhooks, deduplicates events, and supports custom event filtering.

import axios from 'axios';
import { EventEmitter } from 'events';
import { getLastLedgerOffset, setLastLedgerOffset } from '../utils/ledgerOffsetStore';

interface Subscription {
  id: string;
  account: string;
  webhookUrl: string;
  filter?: (event: any) => boolean;
}

interface EventMonitorOptions {
  horizonUrl: string;
  pollIntervalMs?: number;
}

class HorizonEventMonitor extends EventEmitter {
  private subscriptions: Map<string, Subscription> = new Map();
  private horizonUrl: string;
  private pollIntervalMs: number;
  private polling: boolean = false;
  private lastLedger: string | null = null;

  constructor(options: EventMonitorOptions) {
    super();
    this.horizonUrl = options.horizonUrl;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
  }

  addSubscription(sub: Subscription) {
    this.subscriptions.set(sub.id, sub);
  }

  removeSubscription(id: string) {
    this.subscriptions.delete(id);
  }

  async start() {
    this.polling = true;
    this.lastLedger = await getLastLedgerOffset();
    this.pollLoop();
  }

  stop() {
    this.polling = false;
  }

  private async pollLoop() {
    while (this.polling) {
      try {
        await this.pollEvents();
      } catch (err) {
        this.emit('error', err);
      }
      await new Promise(res => setTimeout(res, this.pollIntervalMs));
    }
  }

  private async pollEvents() {
    for (const sub of this.subscriptions.values()) {
      const url = `${this.horizonUrl}/accounts/${sub.account}/payments?order=asc&cursor=${this.lastLedger || 'now'}`;
      const resp = await axios.get(url);
      const records = resp.data._embedded.records;
      for (const event of records) {
        if (this.lastLedger && event.paging_token <= this.lastLedger) continue; // deduplication
        if (sub.filter && !sub.filter(event)) continue; // custom filter
        await this.deliverWebhook(sub, event);
        this.lastLedger = event.paging_token;
        await setLastLedgerOffset(this.lastLedger);
      }
    }
  }

  private async deliverWebhook(sub: Subscription, event: any, attempt = 1) {
    try {
      await axios.post(sub.webhookUrl, event);
    } catch (err) {
      if (attempt < 3) {
        setTimeout(() => this.deliverWebhook(sub, event, attempt + 1), 1000 * attempt);
      } else {
        this.emit('webhook_failed', { sub, event, error: err });
      }
    }
  }
}

export default HorizonEventMonitor;
