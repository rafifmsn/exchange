import { transformUpstream, type RatesPayload } from '../../src/utils/adapter';

declare const EXCHANGE_STORE: any;

// In EdgeOne environment, context contains { request, env, params, waitUntil }
export async function onRequestGet(context: any) {
  const { request, env = {} } = context;

  // 1. Master API Kill Switch
  const isApiDisabled = env.DISABLE_API === 'true' || env.DISABLE_API === true;
  if (isApiDisabled) {
    return new Response(JSON.stringify({ 
      error: 'API is intentionally disabled by environment configuration.', 
      disabled: true 
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 2. Origin & Referer Validation (Security against hotlinking)
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  // Allowed domains list (supports localhost, default edgeone, and custom domains)
  const isAllowed = !origin || 
                    origin.includes('localhost') || 
                    origin.includes('127.0.0.1') || 
                    origin.includes('edgeone.app') || 
                    origin.includes('rafifmsn.com') ||
                    (referer && (
                      referer.includes('edgeone.app') || 
                      referer.includes('rafifmsn.com') || 
                      referer.includes('localhost')
                    ));

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*'
      }
    });
  }

  // 3. Resolve Environment Kill Switches & KV Bindings
  const isKvDisabled = env.DISABLE_KV === 'true' || env.DISABLE_KV === true;
  const isCdnCacheDisabled = env.DISABLE_CDN_CACHE === 'true' || env.DISABLE_CDN_CACHE === true;

  const KV = !isKvDisabled ? (env.EXCHANGE_STORE || (typeof EXCHANGE_STORE !== 'undefined' ? EXCHANGE_STORE : null)) : null;

  // 4. Read existing cache from KV (only if KV is enabled & bound)
  let cachedPayload: RatesPayload | null = null;
  if (KV) {
    try {
      const rawData = await KV.get('rates_usd', 'json');
      if (rawData) {
        cachedPayload = rawData as RatesPayload;
      }
    } catch (err) {
      console.error('Error reading from KV:', err);
    }
  }

  const now = Date.now();

  // If cache is present and still fresh, serve it immediately
  if (cachedPayload && now < cachedPayload.meta.expiresAt) {
    // Generate weak ETag
    const etag = `W/"rates-${cachedPayload.meta.updatedAt}"`;
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304 });
    }

    const remainingSec = Math.max(60, Math.floor((cachedPayload.meta.expiresAt - now) / 1000));
    const cacheControlHeader = isCdnCacheDisabled 
      ? 'no-store, no-cache, must-revalidate' 
      : `public, s-maxage=${remainingSec}, max-age=300`;

    return new Response(JSON.stringify(cachedPayload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControlHeader,
        'Access-Control-Allow-Origin': origin || '*',
        'ETag': etag
      }
    });
  }

  // 5. Cache Miss / Expired / No KV -> Fetch from Upstream Provider
  try {
    const res = await fetch('https://api.frankfurter.dev/v2/rates?base=USD');
    if (!res.ok) {
      throw new Error(`Upstream API error: ${res.status}`);
    }

    const rawRates = await res.json();
    const freshPayload = transformUpstream(rawRates, 'USD');

    // Tag source metadata (honestly identifies that this run fetched from upstream)
    freshPayload.meta.source = 'upstream-fetch';

    // Save to KV asynchronously if KV is enabled & bound
    if (KV) {
      const payloadForKV = JSON.parse(JSON.stringify(freshPayload));
      payloadForKV.meta.source = 'kv-hit';
      context.waitUntil(KV.put('rates_usd', JSON.stringify(payloadForKV)));
    }

    const etag = `W/"rates-${freshPayload.meta.updatedAt}"`;
    const cacheControlHeader = isCdnCacheDisabled 
      ? 'no-store, no-cache, must-revalidate' 
      : 'public, s-maxage=86400, max-age=300';

    return new Response(JSON.stringify(freshPayload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControlHeader,
        'Access-Control-Allow-Origin': origin || '*',
        'ETag': etag
      }
    });

  } catch (err) {
    console.error('Upstream fetch failed, falling back to stale KV cache:', err);

    // Circuit Breaker: Fallback to stale KV data if available
    if (cachedPayload) {
      cachedPayload.meta.stale = true;
      cachedPayload.meta.source = 'kv-hit';

      const etag = `W/"rates-${cachedPayload.meta.updatedAt}"`;
      const cacheControlHeader = isCdnCacheDisabled 
        ? 'no-store, no-cache, must-revalidate' 
        : 'public, s-maxage=300, max-age=300';

      return new Response(JSON.stringify(cachedPayload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': cacheControlHeader,
          'Access-Control-Allow-Origin': origin || '*',
          'ETag': etag
        }
      });
    }

    // Full failure if no KV cache exists at all
    return new Response(JSON.stringify({ error: 'Service Unavailable', details: String(err) }), {
      status: 502,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*'
      }
    });
  }
}
