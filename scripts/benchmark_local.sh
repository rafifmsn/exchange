#!/usr/bin/env bash

# Local Latency Comparison Script
# This script uses curl to measure latency metrics from your local machine.

URLS=(
  "Static Site (With Edge):https://exchange.mvc.my.id/"
  "Static Site (Fallback):https://exchange-dpr8nde7nktf.edgeone.dev/"
  "Edge Function /api/rates:https://exchange.mvc.my.id/api/rates"
  "Direct Upstream (Frankfurter):https://api.frankfurter.dev/v2/rates?base=USD"
)

echo "=========================================================================================="
printf "%-32s | %-10s | %-12s | %-15s | %-10s\n" "TARGET" "DNS" "HANDSHAKE" "SERVER (TTFB)" "TOTAL"
echo "=========================================================================================="

for entry in "${URLS[@]}"; do
  LABEL="${entry%%:*}"
  URL="${entry#*:}"
  
  # Warm up local DNS & connection cache (2 iterations)
  curl -s -o /dev/null "$URL"
  curl -s -o /dev/null "$URL"
  
  # Perform timing measurement
  RES=$(curl -s -o /dev/null -w "%{time_namelookup}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" "$URL")
  
  # Parse timings
  IFS='|' read -r dns appconnect starttransfer total <<< "$RES"
  
  # Convert seconds to milliseconds
  dns_ms=$(awk "BEGIN {print $dns * 1000}")
  appconnect_ms=$(awk "BEGIN {print $appconnect * 1000}")
  starttransfer_ms=$(awk "BEGIN {print $starttransfer * 1000}")
  total_ms=$(awk "BEGIN {print $total * 1000}")
  
  # Calculate Handshake (TCP + TLS) and Server TTFB
  if (( $(awk "BEGIN {print ($appconnect_ms > 0 ? 1 : 0)}") )); then
    handshake_ms=$(awk "BEGIN {print $appconnect_ms - $dns_ms}")
    ttfb_ms=$(awk "BEGIN {print $starttransfer_ms - $appconnect_ms}")
  else
    handshake_ms=0
    ttfb_ms=$starttransfer_ms
  fi
  
  printf "%-32s | %-7.1f ms | %-9.1f ms | %-12.1f ms | %-7.1f ms\n" \
    "$LABEL" "$dns_ms" "$handshake_ms" "$ttfb_ms" "$total_ms"
done
echo "=========================================================================================="
