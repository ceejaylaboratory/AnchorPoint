// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import { createBreaker, BreakerOptions } from './circuit-breaker.factory';
import logger from '../utils/logger';

export interface ThirdPartyResponse<T> {
  available: boolean;
  cached: boolean;
  data: T | null;
}

export class ThirdPartyProxy {
  private breaker;
  // In-memory LRU cache of last successful response per endpoint.
  // In a real production system, this could use an actual LRU cache library (e.g. lru-cache)
  private lruCache: Map<string, any> = new Map();
  private maxCacheSize = 1000;

  constructor(private name: string, private baseUrl: string, options?: Partial<BreakerOptions>) {
    this.breaker = createBreaker(
      name,
      async (endpoint: string, fetchOptions?: RequestInit) => {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${name}`);
        }
        const data = await response.json();
        
        // Cache successful response
        this.cacheResponse(endpoint, data);
        
        return {
          available: true,
          cached: false,
          data
        };
      },
      options
    );

    this.breaker.fallback(async (endpoint: string, fetchOptions: RequestInit | undefined, error: Error) => {
      logger.warn(`[${this.name}] Circuit breaker triggered for ${endpoint}. Reason: ${error.message}. Returning cached response if available.`);
      
      const cachedData = this.lruCache.get(endpoint) || null;
      
      return {
        available: false,
        cached: true,
        data: cachedData
      };
    });
  }

  public async fetch<T = any>(endpoint: string, options?: RequestInit): Promise<ThirdPartyResponse<T>> {
    return this.breaker.fire(endpoint, options) as Promise<ThirdPartyResponse<T>>;
  }

  private cacheResponse(endpoint: string, data: any) {
    if (this.lruCache.size >= this.maxCacheSize) {
      // Remove the oldest entry (Map iterates in insertion order)
      const firstKey = this.lruCache.keys().next().value;
      if (firstKey) this.lruCache.delete(firstKey);
    }
    this.lruCache.set(endpoint, data);
  }
}

export function createThirdPartyProxy(name: string, baseUrl: string, options?: Partial<BreakerOptions>) {
  return new ThirdPartyProxy(name, baseUrl, options);
}
