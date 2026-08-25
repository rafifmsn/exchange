#!/usr/bin/env node

/**
 * Globalping Benchmark Script for rafifmsn/exchange
 * This script runs HTTP measurements from multiple regions around the world
 * to compare performance of:
 * 1. Edge Function (/api/rates)
 * 2. Static Site 1 (With Edge)
 * 3. Static Site 2 (Fallback)
 * 4. Direct Upstream (Frankfurter API)
 */

const HOST = process.env.BENCHMARK_HOST || 'your-custom-domain.com';
const FALLBACK_HOST = process.env.FALLBACK_HOST || 'your-fallback-domain.dev';

const TARGETS = [
  {
    name: 'Static Site (With Edge)',
    host: HOST,
    options: {
      request: { path: '/', method: 'GET' },
      protocol: 'HTTPS',
    },
  },
  {
    name: 'Static Site (Fallback)',
    host: FALLBACK_HOST,
    options: {
      request: { path: '/', method: 'GET' },
      protocol: 'HTTPS',
    },
  },
  {
    name: 'Edge Function /api/rates',
    host: HOST,
    options: {
      request: { path: '/api/rates', method: 'GET' },
      protocol: 'HTTPS',
    },
  },
  {
    name: 'Direct Upstream (Frankfurter)',
    host: 'api.frankfurter.dev',
    options: {
      request: { path: '/v2/rates', query: 'base=USD', method: 'GET' },
      protocol: 'HTTPS',
    },
  },
];

// Target regions representing diverse global locations
const LOCATIONS = [
  { country: 'SG', label: 'Singapore' },
  { country: 'DE', label: 'Germany' },
  { country: 'US', label: 'United States' },
  { country: 'ID', label: 'Indonesia' },
  { country: 'BR', label: 'Brazil' },
  { country: 'AU', label: 'Australia' },
  { country: 'JP', label: 'Japan' },
];

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerMeasurement(target) {
  console.log(`Triggering measurement for ${target.name}...`);
  try {
    const response = await fetch('https://api.globalping.io/v1/measurements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AntigravityBenchmarkScript/1.0',
      },
      body: JSON.stringify({
        type: 'http',
        target: target.host,
        locations: LOCATIONS.map(loc => ({ country: loc.country })),
        limit: LOCATIONS.length * 2, // Allow up to 2 probes per country for variance
        measurementOptions: target.options,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Globalping API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error(`Failed to trigger measurement for ${target.name}:`, error.message);
    return null;
  }
}

async function pollResults(measurementId) {
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await delay(2000);
    try {
      const response = await fetch(`https://api.globalping.io/v1/measurements/${measurementId}`, {
        headers: {
          'User-Agent': 'AntigravityBenchmarkScript/1.0',
        },
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      if (data.status === 'finished') {
        return data.results;
      }
    } catch (error) {
      // Ignore network flakiness during polling
    }
  }
  return null;
}

function processResults(results) {
  const processed = {};
  if (!results) return processed;

  for (const r of results) {
    const country = r.probe.country;
    const label = LOCATIONS.find(l => l.country === country)?.label || country;

    if (r.result && r.result.statusCode === 200 && r.result.timings) {
      const t = r.result.timings;

      if (!processed[label]) {
        processed[label] = {
          dns: [],
          tcp: [],
          tls: [],
          ttfb: [],
          total: [],
        };
      }

      processed[label].dns.push(t.dns || 0);
      processed[label].tcp.push(t.tcp || 0);
      processed[label].tls.push(t.tls || 0);
      processed[label].ttfb.push(t.firstByte || 0);
      processed[label].total.push(t.total || 0);
    }
  }

  // Calculate averages per location
  const averages = {};
  for (const [location, metrics] of Object.entries(processed)) {
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    averages[location] = {
      dns: avg(metrics.dns),
      handshake: avg(metrics.tcp) + avg(metrics.tls), // Connect + TLS handshake
      ttfb: avg(metrics.ttfb),
      total: avg(metrics.total),
    };
  }

  return averages;
}

async function main() {
  console.log('===========================================================');
  console.log('Starting Global Network Latency Benchmarks via Globalping');
  console.log('===========================================================');

  const measurementIds = [];
  for (const target of TARGETS) {
    const id = await triggerMeasurement(target);
    if (id) {
      measurementIds.push({ ...target, id });
    }
  }

  console.log('\nPolling for results (this may take up to 30 seconds)...');
  const allResults = {};

  for (const target of measurementIds) {
    const results = await pollResults(target.id);
    if (results) {
      allResults[target.name] = processResults(results);
      console.log(`✓ Received results for: ${target.name}`);
    } else {
      console.log(`✗ Timed out waiting for results: ${target.name}`);
    }
  }

  console.log('\n========================================================================================');
  console.log('BENCHMARK RESULTS SUMMARY (Averages in milliseconds)');
  console.log('========================================================================================\n');

  for (const target of TARGETS) {
    const data = allResults[target.name];
    if (!data || Object.keys(data).length === 0) {
      console.log(`No results for ${target.name}\n`);
      continue;
    }

    console.log(`### ${target.name} (${target.host}${target.options.request.path || ''})`);
    console.log('| Location | DNS | Handshake (TCP+TLS) | Server (TTFB) | Total |');
    console.log('|---|---|---|---|---|');
    for (const [loc, m] of Object.entries(data)) {
      console.log(`| ${loc} | ${m.dns} ms | ${m.handshake} ms | ${m.ttfb} ms | ${m.total} ms |`);
    }
    console.log('\n');
  }
}

main();
