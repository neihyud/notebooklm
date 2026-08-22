# Issue tracker

Tracker của repo này là **file trong repo**, không phải GitHub Issues.

Lý do: `gh` trên máy này chưa `gh auth login`, nên mọi lệnh chạm GitHub API đều fail. Đổi sang
GitHub Issues thì sửa file này và chuyển các ticket đang mở.

- **Spec**: `docs/spec/NNNN-slug.md`
- **Ticket**: `docs/tickets/NNN-slug.md`, một file một ticket
- **Blocking edges**: khai bằng text trong frontmatter `blocked_by:` của từng ticket
- **Triage label**: frontmatter `labels:`; `ready-for-agent` nghĩa là peer nhận được ngay

## Trạng thái ticket

`open` → `in-progress` (Lead ghi khi giao cho peer) → `candidate` (peer handback, chờ nghiệm
thu) → `done`. Lead là người đổi trạng thái, không phải peer.
