#!/usr/bin/env node

/**
 * Local Latency Comparison Script (Node.js version)
 * This script measures connection and response timings from your local machine.
 * 
 * Usage:
 *   BENCHMARK_HOST=exchange.mvc.my.id FALLBACK_HOST=exchange-dpr8nde7nktf.edgeone.dev node scripts/benchmark_local.js
 */

import https from 'https';
import { performance } from 'perf_hooks';

const HOST = process.env.BENCHMARK_HOST || 'your-custom-domain.com';
const FALLBACK_HOST = process.env.FALLBACK_HOST || 'your-fallback-domain.dev';

const TARGETS = [
  { name: 'Static Site (With Edge)', url: `https://${HOST}/` },
  { name: 'Static Site (Fallback)', url: `https://${FALLBACK_HOST}/` },
  { name: 'Edge Function /api/rates', url: `https://${HOST}/api/rates` },
  { name: 'Direct Upstream (Frankfurter)', url: `https://api.frankfurter.dev/v2/rates?base=USD` }
];

function measure(url) {
  return new Promise((resolve) => {
    const timings = {
      dns: 0,
      handshake: 0,
      ttfb: 0,
      total: 0,
      statusCode: 0
    };

    const startTime = performance.now();
    let dnsTime = 0;
    let connectTime = 0;
    let secureConnectTime = 0;

    const req = https.get(url, { agent: false }, (res) => {
      timings.statusCode = res.statusCode;
      const ttfbAnchor = secureConnectTime || connectTime || startTime;
      timings.ttfb = performance.now() - ttfbAnchor;
      
      res.on('data', () => {});
      res.on('end', () => {
        timings.total = performance.now() - startTime;
        resolve(timings);
      });
    });

    req.on('socket', (socket) => {
      socket.on('lookup', () => {
        dnsTime = performance.now();
        timings.dns = dnsTime - startTime;
      });

      socket.on('connect', () => {
        connectTime = performance.now();
      });

      socket.on('secureConnect', () => {
        secureConnectTime = performance.now();
        const handshakeAnchor = dnsTime || startTime;
        timings.handshake = secureConnectTime - handshakeAnchor;
      });
    });

    req.on('error', (err) => {
      resolve({
        dns: 0,
        handshake: 0,
        ttfb: 0,
        total: 0,
        statusCode: 0,
        error: err.message
      });
    });
  });
}

async function run() {
  console.log("==========================================================================================");
  console.log(`BENCHMARKING HOSTS:`);
  console.log(`  - Target Host:   ${HOST}`);
  console.log(`  - Fallback Host: ${FALLBACK_HOST}`);
  console.log("==========================================================================================");
  console.log(
    String("TARGET").padEnd(30) + " | " +
    String("HTTP").padEnd(4) + " | " +
    String("DNS").padStart(8) + " | " +
    String("HANDSHAKE").padStart(10) + " | " +
    String("SERVER (TTFB)").padStart(14) + " | " +
    String("TOTAL").padStart(8)
  );
  console.log("==========================================================================================");

  for (const target of TARGETS) {
    // Warm up connection (1 iteration)
    await measure(target.url);
    
    // Perform timing measurement
    const metrics = await measure(target.url);

    if (metrics.error) {
      console.log(`${target.name.padEnd(30)} | ERR  | Failed to connect: ${metrics.error}`);
      continue;
    }

    const dnsStr = `${metrics.dns.toFixed(1)} ms`;
    const handshakeStr = `${metrics.handshake.toFixed(1)} ms`;
    const ttfbStr = `${metrics.ttfb.toFixed(1)} ms`;
    const totalStr = `${metrics.total.toFixed(1)} ms`;

    console.log(
      target.name.padEnd(30) + " | " +
      String(metrics.statusCode).padEnd(4) + " | " +
      dnsStr.padStart(8) + " | " +
      handshakeStr.padStart(10) + " | " +
      ttfbStr.padStart(14) + " | " +
      totalStr.padStart(8)
    );
  }
  console.log("==========================================================================================");
}

run();
