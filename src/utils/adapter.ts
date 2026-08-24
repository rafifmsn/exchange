export interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

export interface RatesPayload {
  base: string;
  rates: Record<string, number>;
  meta: {
    providerDate: string;
    updatedAt: number;
    expiresAt: number;
    stale: boolean;
    source: 'cache-hit' | 'kv-hit' | 'upstream-fetch' | 'upstream-direct-fallback' | 'kv' | 'upstream';
  };
}

export function transformUpstream(data: unknown, baseCurrency: string = 'USD'): RatesPayload {
  if (!Array.isArray(data)) {
    throw new Error('Invalid response from Frankfurter API: expected an array');
  }

  const rates: Record<string, number> = {
    [baseCurrency]: 1.0 // Base rate is always 1.0
  };

  let providerDate = new Date().toISOString().split('T')[0];

  for (const item of data) {
    if (typeof item === 'object' && item !== null && 'base' in item && 'quote' in item && 'rate' in item) {
      const rateObj = item as Record<string, unknown>;
      const base = String(rateObj.base);
      const quote = String(rateObj.quote);
      const rateVal = Number(rateObj.rate);

      if (base === baseCurrency && !isNaN(rateVal)) {
        rates[quote] = rateVal;
        if (typeof rateObj.date === 'string') {
          providerDate = rateObj.date;
        }
      }
    }
  }

  const now = Date.now();
  const CACHE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  return {
    base: baseCurrency,
    rates,
    meta: {
      providerDate,
      updatedAt: now,
      expiresAt: now + CACHE_INTERVAL_MS,
      stale: false,
      source: 'upstream'
    }
  };
}
