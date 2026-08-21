#!/usr/bin/env bash
#
# Tải transcript hàng loạt bằng yt-dlp — kể cả video PRIVATE của chính bạn.
#
#   bash tools/fetch-transcripts.sh [thư-mục-đích] [ngôn-ngữ]
#
# Vì sao dùng yt-dlp thay vì extension: extension phải MỞ trang watch cho từng
# video private (~15–20 giây/video) vì hai đường API của YouTube đều bị chặn.
# yt-dlp lấy thẳng qua API nên nhanh hơn nhiều lần, và chạy được khi trình duyệt
# đang đóng.
#
# Hai thứ bắt buộc, thiếu là hỏng câm:
#   1. `secretstorage` — không có thì cookie Brave không giải mã được và YouTube
#      chỉ báo "Please sign in". Cài kèm: uv tool install yt-dlp --with secretstorage
#   2. `+gnomekeyring` — phải chỉ đúng keyring của hệ thống, mặc định dò không ra.
#
# Cũng cần `--ignore-no-formats-error`: ta bỏ qua phần video, nhưng yt-dlp vẫn
# cố chọn định dạng và sẽ dừng với "Requested format is not available".
set -uo pipefail

DEST="${1:-$HOME/Downloads/Transcript YouTube}"
LANGS="${2:-en}"
LIST="$(dirname "$0")/videos.txt"
PROFILE="${BRAVE_PROFILE:-brave+gnomekeyring:Profile 4}"

export PATH="$HOME/.local/bin:$PATH"
command -v yt-dlp >/dev/null || { echo "Chưa có yt-dlp. Cài: uv tool install yt-dlp --with secretstorage"; exit 1; }
[ -f "$LIST" ] || { echo "Không thấy danh sách: $LIST"; exit 1; }

mkdir -p "$DEST"
ARCHIVE="$DEST/.yt-dlp-archive.txt"   # đã tải rồi thì lần sau bỏ qua -> chạy lại an toàn
URLS="$(mktemp)"
sed 's#^#https://www.youtube.com/watch?v=#' "$LIST" > "$URLS"

echo "nguồn   : $LIST ($(wc -l < "$LIST") video)"
echo "đích    : $DEST"
echo "ngôn ngữ: $LANGS"
echo

# Tên file mang luôn videoId để bước chuyển sang .md dò được nguồn mà không phải
# đoán theo tiêu đề.
yt-dlp \
  --cookies-from-browser "$PROFILE" \
  --js-runtimes node \
  --skip-download --ignore-no-formats-error --ignore-errors --no-warnings \
  --write-auto-subs --write-subs --sub-langs "$LANGS" --sub-format "vtt" \
  --download-archive "$ARCHIVE" \
  --sleep-requests 1 \
  -o "$DEST/%(autonumber)03d - %(id)s - %(title)s.%(ext)s" \
  --batch-file "$URLS" 2>&1 | grep -viE "^\[download\] +[0-9.]+%|Downloading (webpage|player|tv |android)"

rm -f "$URLS"
echo
echo "xong · $(find "$DEST" -name '*.vtt' | wc -l) file .vtt trong $DEST"
echo "chuyển sang .md/.txt:  node tools/subs-to-md.mjs \"$DEST\""
