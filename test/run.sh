#!/usr/bin/env bash
# Chạy toàn bộ test: bash test/run.sh
set -e
cd "$(dirname "$0")/.."
for f in test/*.test.js; do echo "── $f"; node "$f"; done
echo "── kiểm tra cú pháp"
for f in $(find src -name '*.js'); do node --check "$f"; done
echo "✅ toàn bộ JS parse sạch"
