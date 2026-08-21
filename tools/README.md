# tools/ — công cụ chạy ngoài extension

Các script ở đây **không phải một phần của extension**. Chúng chạy bằng Node hoặc Bash trên máy, phục vụ hai việc: tải transcript hàng loạt nhanh hơn extension, và kiểm chứng những phần không test tự động được.

Chúng nằm ngoài `src/` nên `test/manifest.test.js` không đụng tới.

---

## Đường tải transcript bằng yt-dlp

### Vì sao có nó, trong khi extension đã tải được

Extension tải được transcript video private — nhưng chậm. Với video private, hai đường API của YouTube đều bị chặn (`get_transcript` trả `FAILED_PRECONDITION`, `timedtext` trả rỗng vì PoToken), nên nó buộc rơi xuống phương án quét DOM: **mở thật một trang watch cho từng video**, khoảng 15–20 giây mỗi cái.

yt-dlp lấy thẳng qua API, không mở trang nào. Đo thực tế trên 89 video private: **9 phút, 0 lỗi** — nhanh gấp khoảng ba lần, và chạy được cả khi trình duyệt đang đóng.

Extension vẫn hơn ở chỗ: không cần cài gì, và nó là đường duy nhất đẩy thẳng vào NotebookLM.

### Chuẩn bị

```bash
uv tool install yt-dlp --with secretstorage     # secretstorage BẮT BUỘC, xem bẫy 1
```

Cần thêm: `node` (cho bước chuyển định dạng), và `ffmpeg` nếu muốn yt-dlp tự đổi sang `.srt`.

### Dùng

```bash
# 1. Danh sách video — mỗi dòng một videoId
#    (tools/videos.txt hiện có 89 id trích từ hàng đợi extension)

# 2. Tải phụ đề
bash tools/fetch-transcripts.sh                          # mặc định: ~/Downloads/Transcript YouTube, tiếng Anh
bash tools/fetch-transcripts.sh "/duong/dan/khac" vi     # đổi thư mục và ngôn ngữ

# 3. Chuyển sang .md + .txt
node tools/subs-to-md.mjs "$HOME/Downloads/Transcript YouTube" both
node tools/subs-to-md.mjs "$HOME/Downloads/Transcript YouTube" md    # chỉ .md
```

Hồ sơ trình duyệt đổi được qua biến môi trường:

```bash
BRAVE_PROFILE="brave+gnomekeyring:Default" bash tools/fetch-transcripts.sh
```

Script có `--download-archive`, nên **chạy lại chỉ tải video mới**. Thêm id vào `videos.txt` rồi chạy lại là đủ, không tải trùng.

### Kết quả

```
~/Downloads/Transcript YouTube/
  007 - 8RZgejm5Hbc - Tiêu đề video.en.vtt    ← gốc từ YouTube
  007 - 8RZgejm5Hbc - Tiêu đề video.md        ← có header + link nhảy tới đúng giây
  007 - 8RZgejm5Hbc - Tiêu đề video.txt       ← dòng [m:ss] thuần
```

videoId nằm ngay trong tên file — đó là chủ ý: bước chuyển sang `.md` dò được nguồn chính xác thay vì đoán theo tiêu đề. File `.md` dùng đúng hàm `toMarkdown` của extension (`src/youtube/srt.js`) nên giống hệt bản extension tự tải.

---

## Ba cái bẫy, và vì sao chúng khó đoán

Cả ba đều làm hỏng câm — không có thông báo nào chỉ đúng nguyên nhân.

### 1. Cookie không giải mã được → YouTube chỉ nói "Please sign in"

Brave mã hoá cookie bằng khoá nằm trong keyring của hệ điều hành. Chạy trần:

```
Extracted 0 cookies from brave (997 could not be decrypted)
ERROR: Please sign in.
```

Đọc được 997 cookie, giải mã được 0. Thông báo lại đổ cho việc chưa đăng nhập — sai hoàn toàn hướng.

Cần **hai** thứ, thiếu một là hỏng:

- `+gnomekeyring` trong `--cookies-from-browser`. Không chỉ định thì yt-dlp dò không ra keyring.
- Module `secretstorage`. Thiếu nó thì báo `secretstorage not available` rồi vẫn chạy tiếp với một phần cookie — lúc đó lỗi đổi thành `Private video. Sign in if you've been granted access`, nghe như thiếu quyền chứ không phải thiếu thư viện.

Đủ cả hai thì `Extracted 985 cookies from brave`, không cảnh báo.

Xác định keyring của máy: `pgrep -a "kwallet|gnome-keyring"`.

### 2. `Requested format is not available`

Ta bỏ qua phần video (`--skip-download`) nhưng yt-dlp vẫn cố chọn định dạng video rồi dừng hẳn. Cần `--ignore-no-formats-error`.

Cảnh báo `n challenge solving failed` đi kèm là **vô hại** ở đây — nó chỉ ảnh hưởng việc tải video, không ảnh hưởng phụ đề.

### 3. Phụ đề tự động cuộn như bảng điện tử

Đây là bẫy nặng nhất, và nó **không gây lỗi** — chỉ cho ra kết quả rác trông như hợp lệ.

Phụ đề tự động của YouTube hiển thị kiểu cuộn: mỗi khối lặp lại nguyên văn dòng trước rồi thêm vài chữ mới, kèm thẻ định thời từng từ (`<00:00:01.234><c> chữ</c>`). Đổ thẳng `.vtt` ra text thì transcript lặp đến mức không đọc nổi — đo thực tế: **37 KB `.vtt` → 4,6 KB `.txt`** sau khi xử lý.

`subs-to-md.mjs` làm ba việc: bóc thẻ định thời, cắt phần đầu trùng với khối trước (kể cả chồng lấn một phần), rồi gộp các mẩu cách nhau dưới 1,5 giây thành một dòng. Kiểm trên file thật: **93 dòng, 0 dòng trùng lặp**.

---

## Cookie được mã hoá và giải mã ra sao

Phần này giải thích *cơ chế*, để hiểu vì sao từng tham số ở bẫy 1 lại bắt buộc. Toàn bộ tham số dưới đây đọc trực tiếp từ `yt_dlp/cookies.py` của bản đang cài, không phải viết theo trí nhớ.

### Cookie nằm ở đâu

`~/.config/BraveSoftware/Brave-Browser/<Profile>/Cookies` — một CSDL SQLite. Cột `encrypted_value` chứa dữ liệu đã mã hoá; **3 byte đầu là nhãn phiên bản**, phần còn lại là ciphertext.

### Hai phiên bản, khác nhau đúng một chỗ

| Nhãn | Mật khẩu dùng để dẫn xuất khoá | Hệ quả |
|---|---|---|
| `v10` | chuỗi cố định `peanuts` | ai cũng giải được, không cần keyring |
| `v11` | lấy từ keyring của hệ điều hành (mục **"Brave Safe Storage"**) | **phải mở được keyring** |

Ngoài mật khẩu, mọi thứ còn lại giống hệt nhau:

- **Dẫn xuất khoá**: PBKDF2-HMAC-SHA1, salt `saltysalt`, **1 vòng lặp** trên Linux, khoá dài 16 byte
  (macOS dùng 1003 vòng — cùng thuật toán, khác tham số)
- **Giải mã**: AES-128-CBC, IV là **16 byte khoảng trắng** (`0x20`), bỏ đệm PKCS#7

Một vòng lặp PBKDF2 nghĩa là bước dẫn xuất gần như không tốn gì. Lớp bảo vệ thật của `v11` nằm ở chỗ **mật khẩu nằm trong keyring**, không nằm ở độ khó tính toán.

### Vì sao cần `secretstorage`

Để đọc mục "Brave Safe Storage" trong gnome-keyring phải nói chuyện với keyring qua **DBus**, và `secretstorage` chính là thư viện làm việc đó. Không có nó thì yt-dlp không lấy được mật khẩu, `self._v11_key` là `None`, và mọi cookie `v11` bị bỏ qua:

```
cannot decrypt v11 cookies: no key found
Extracted 0 cookies from brave (997 could not be decrypted)
```

Với KDE thì đường tương ứng là **kwallet** qua DBus (`org.kde.kwalletd`). yt-dlp hỗ trợ cả hai, nhưng **phải chỉ đúng cái nào** — đó là ý nghĩa của `+gnomekeyring`.

### Vì sao có cảnh báo "UTF-8 decoding failed"

yt-dlp không có cách nào biết chắc khoá đúng hay sai. Nó thử giải mã, rồi **kiểm tra kết quả có phải UTF-8 hợp lệ không** — sai khoá thì AES vẫn cho ra byte, chỉ là byte rác:

```
failed to decrypt cookie (AES-CBC) because UTF-8 decoding failed. Possibly the key is wrong?
```

Nên câu đó **không** có nghĩa "cookie hỏng", mà gần như luôn có nghĩa "khoá sai". Nó cũng thử thêm khoá rỗng làm dự phòng, theo đúng một bản vá của Chromium.

### Một chi tiết dễ vấp: 32 byte đầu không phải cookie

Từ khi Chromium nâng `meta_version` lên 24, phần rõ sau khi giải mã có **32 byte đầu là băm SHA-256 của tên miền**, gắn kèm để chống mang cookie sang tên miền khác. Phải cắt bỏ 32 byte đó mới ra giá trị cookie thật.

Đọc thẳng mà quên cắt thì ra chuỗi rác ở đầu mỗi cookie — trông như lỗi giải mã trong khi khoá hoàn toàn đúng.

### Ranh giới cố ý

Repo này **không kèm script giải mã cookie**, và sẽ không kèm. Mô tả trên là để hiểu và gỡ lỗi khi yt-dlp báo sai; còn việc giải mã do chính yt-dlp làm trong bộ nhớ. Muốn xem cài đặt cụ thể thì đọc `yt_dlp/cookies.py`, hàm `_decrypt_aes_cbc_multi` và lớp `LinuxChromeCookieDecryptor`.

---

## Về bảo mật

**Không có mã giải mã cookie nào trong repo này.** yt-dlp tự giải mã trong bộ nhớ, dùng `secretstorage` để hỏi keyring qua DBus. Script chỉ truyền cho nó một chuỗi cấu hình *tìm ở đâu* — không phải khoá, không phải cookie.

Cố tình **không** dùng `--cookies FILE`: cờ đó sẽ xuất toàn bộ cookie ra file văn bản thuần trên đĩa. Không có cookie jar nào được ghi ra, và cache yt-dlp trống.

Muốn gỡ sạch:

```bash
uv tool uninstall yt-dlp
```

Transcript đã tải không phụ thuộc gì vào yt-dlp sau đó.

---

## Công cụ kiểm chứng

Phần DOM của extension không test tự động được (không có jsdom, và một bộ shim DOM tự viết chỉ tạo cảm giác an toàn giả). Các script này chạy mã nguồn thật trên trang thật.

| Script | Việc |
|---|---|
| `verify-live.mjs` | Nạp `transcript.js` vào trang YouTube thật, chạy `fromPanel()`. Không cần đăng nhập, không cần nạp extension. |
| `verify-docs.mjs` | Kiểm `extract.js`/`markdown.js` trên 4 bộ tạo docs (Docusaurus, MkDocs, VitePress, Sphinx). |
| `probe-sidebar.mjs` | Dump điểm `rate()` của mọi ứng viên sidebar trên một trang — dùng khi dò sidebar ra kết quả sai. |

```bash
node tools/verify-live.mjs [videoId]
node tools/verify-docs.mjs
```

Ba lỗi thật đã bị `verify-live.mjs` bắt: extension bấm nhầm nút "Transcript" của chính nó, selector trỏ vào layout transcript YouTube đã thay, và `el.click()` không mở được panel. Chi tiết trong README chính, mục *"Ba lỗi mà chỉ trang thật mới lộ ra"*.

Lưu ý khi chạy: cửa sổ phải đủ rộng (`--window-size=1680,1050`). Panel transcript nằm ở cột phải; ở layout hẹp YouTube giữ nó ở trạng thái `ENGAGEMENT_PANEL_VISIBILITY_HIDDEN` và không có gì để quét.

---

## `txt-to-md.mjs` — trường hợp riêng

Chuyển các file `.txt` **do extension tải** sang `.md`. Khác `subs-to-md.mjs` ở chỗ file `.txt` của extension không mang videoId trong tên, nên nó dò ngược metadata từ hàng đợi trong storage của extension, khớp theo tiêu đề.

Dùng khi bạn đã có file `.txt` từ extension và muốn thêm bản `.md` có link nguồn. Với file từ yt-dlp thì dùng `subs-to-md.mjs`.
