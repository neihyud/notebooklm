#!/usr/bin/env bash
# Chạy toàn bộ test: bash test/run.sh
set -e
cd "$(dirname "$0")/.."
# test/notebooklm-dom.test.js cần jsdom (dependency DEV duy nhất của repo — mã chạy
# trong extension vẫn không dùng dependency nào). Báo rõ thay vì để stack trace mơ hồ.
node -e 'require.resolve("jsdom")' 2>/dev/null || {
  echo "❌ thiếu jsdom — chạy 'npm install' trước (chỉ cần cho test, không ảnh hưởng extension)" >&2
  exit 1
}

for f in test/*.test.js; do echo "── $f"; node "$f"; done
echo "── kiểm tra cú pháp"
for f in $(find src -name '*.js'); do node --check "$f"; done
echo "✅ toàn bộ JS parse sạch"
