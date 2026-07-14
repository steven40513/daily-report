# CLAUDE.md — 營建日報系統

行動端日報填報 PWA。目標用戶：50-60 歲工地主任，收工後 10-15 分鐘內用手機填完日報、產出 PDF、透過 LINE 分享。試用專案：高鐵綻。

## 三個 HTML 版本的角色（重要）

| 檔案 | 角色 | 說明 |
|------|------|------|
| `index.html` | **v0.1 正式試用版** | 已封版交付現場試用，只做 bug 修復，不加新功能 |
| `beta/index.html` | **開發中下一版** | 新功能都在這裡做（缺件提醒、補填、日報行事曆等） |
| `prototype.html` | 舊原型 | 保留參考用，原則上不再改 |

改動前先確認要改哪一版。新功能 → beta；試用者回報的 bug → index.html（必要時同步到 beta）。

## 技術架構

- 單一 HTML 檔（vanilla JS + inline CSS），無建置流程，直接開檔即用
- 本機資料存 localStorage；雲端同步用 Supabase（PostgreSQL + Auth）
- 登入：LINE Login（Supabase custom OAuth provider，PKCE flow）+ Email
- LINE 登入有已知的坑，改動 auth 相關程式前**必讀** `LINE_LOGIN_DEBUG.md`
- 診斷面板：網址加 `?debug=1` 開啟、`?debug=0` 關閉（記在 localStorage）
- PWA：`manifest.json` + icon，iPhone Safari 加入主畫面使用

## Supabase

- 資料夾慣例（檔名前綴 `YYYYMMDDNNNN`）：
  - `supabase/migrations/` — schema 變更
  - `supabase/seed/` — 初始資料
  - `supabase/diagnostics/` — 查錯用 SQL，不屬於 schema
- Supabase URL 與 publishable key 寫在 `index.html` 的 `SUPABASE_CONFIG`（約 915 行）
- 改 schema 時同步更新 `scripts/validate-supabase-schema.js`
- 已知限制：`backfilled`（補填標記）只存本機，未同步到 Supabase

## 測試

```bash
npm test            # 全部（smoke + extended + remaining + beta + schema）
npm run test:smoke  # index.html 基本功能
npm run test:beta   # beta 版功能
npm run test:schema # Supabase schema 驗證
```

- 測試用 jsdom 跑，無需瀏覽器。**每次改動後必跑對應測試**，commit 前跑 `npm test`
- 正式版相關測試（smoke/extended/remaining）不應因 beta 開發而改變結果

## 文件

- `營建日報系統_討論紀錄.md` — 主要決策紀錄，**每次 session 結束前在文末補充本次變更**
- `docs/mvp-scope.md` — MVP 功能範圍與驗收標準
- `docs/v0.1-trial-release.md` — v0.1 封版說明
- `docs/testing/` — 各階段驗收測試紀錄
- `LINE_LOGIN_DEBUG.md` — LINE × Supabase 整合踩坑指南（給 AI 與開發者）

## 工作慣例

- 每完成一個功能就 commit，不要累積多天工作
- Commit 訊息用中文，格式 `feat:` / `fix:` / `docs:` 前綴
- 使用者介面文字用繁體中文，面向非技術背景的工地人員，用詞要口語
- 溝通語言：繁體中文

## GitHub 更新流程（重要，完整版見討論紀錄十八）

- Repo：`https://github.com/steven40513/daily-report`（公開，GitHub Pages 部署）
- **改動前**先 `git fetch https://github.com/steven40513/daily-report.git main` 比對本機，確認沒分岔
- Cowork/雲端沙箱**只能讀不能 push**（無 SSH 金鑰）→ push 請使用者跑 `git push origin main` 或交給本機的 Claude Code
- 含 schema 變更時：**先在 Supabase SQL Editor 跑 migration，再 push**
- 內部文件（討論紀錄、docs/superpowers/、docs/backend-data-plan.md）已在 .gitignore，**永不上傳**；絕不 force push
- seed/diagnostics 檔案用 `REPLACE_WITH_*` 佔位符，不寫真實姓名/UUID

## 目前待辦（2026-07 初）

- 多層級通報升級機制（需獨立設計：人員階級模型、通知管道、後端排程）
- 選填欄位（時段／今日工時／明日工作內容／代工廠商）只有資料結構，缺卡片 UI
- 缺件判斷從開工日算起的已知限制（老專案首次使用會顯示大量缺件）
