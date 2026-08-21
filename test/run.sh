#!/usr/bin/env bash
#
# Runner của repo. Ba điều nó cố ý làm khác mặc định, mỗi điều vá một kiểu "xanh nhầm":
#
#   1. Liệt kê từng file test ra dòng lệnh. `node --test test/` trên Node 22 KHÔNG duyệt thư
#      mục: nó resolve `test/` thành một module và chết bằng MODULE_NOT_FOUND, trông y hệt một
#      test đỏ. Đã xảy ra thật ở repo này.
#   2. Chạy 0 file là ĐỎ. `node --test` với danh sách rỗng exit 0 — một suite không chạy gì mà
#      báo xanh là cách tệ nhất để mất niềm tin vào cả bộ test.
#   3. Một file không có `test()` nào cũng là ĐỎ. Node đếm chính file đó là một test và exit 0,
#      nên `tests N > 0` một mình không đủ để nói suite có thật sự chạy gì.
#
# Reporter: spec ra màn hình cho người đọc, TAP ra file cho chính script này đọc — để quyết
# định xanh/đỏ không đổi theo việc có TTY hay không.
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

shopt -s nullglob
files=(test/*.test.js)

if [ ${#files[@]} -eq 0 ]; then
  echo "test/run.sh: KHÔNG tìm thấy file test nào khớp test/*.test.js — coi là đỏ." >&2
  exit 1
fi

echo "test/run.sh: ${#files[@]} file test"
printf '  - %s\n' "${files[@]}"
echo

tap=$(mktemp)
trap 'rm -f "$tap"' EXIT

node --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=tap --test-reporter-destination="$tap" \
  "${files[@]}"
status=$?

count=$(sed -n 's/^# tests \([0-9]\{1,\}\)$/\1/p' "$tap" | tail -n 1)

if [ -z "$count" ]; then
  echo >&2
  echo "test/run.sh: không đọc được dòng 'tests N' trong output — coi là đỏ." >&2
  exit 1
fi

# Một file chạy 0 test hiện ra ở TAP như một entry top-level mang đúng tên file.
for file in "${files[@]}"; do
  if grep -qE "^ok [0-9]+ - $(printf '%s' "$file" | sed 's/[.[\*^$]/\\&/g')\$" "$tap"; then
    echo >&2
    echo "test/run.sh: $file không chạy test nào (Node vẫn đếm nó là một test) — coi là đỏ." >&2
    exit 1
  fi
done

if [ "$count" -eq 0 ]; then
  echo >&2
  echo "test/run.sh: chạy $count test. Suite chạy 0 test là đỏ, không phải xanh." >&2
  exit 1
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "test/run.sh: ĐỎ ($count test, node --test exit $status)." >&2
  exit "$status"
fi

echo
echo "test/run.sh: XANH — tests $count, ${#files[@]} file."
