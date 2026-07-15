-- 材料/機具「廠商」欄位同步雲端
-- 背景：資料填寫強化（2026-07-02）在前端為材料/機具品項加了選填「廠商」欄位，
-- 但只存 localStorage 沒同步。月結核對（區間彙總查詢）需要逐日明細帶廠商，
-- 多裝置情境下必須從雲端也讀得到。
-- 冪等設計，可重複執行。只加欄位，舊版前端不受影響。

alter table public.report_items
  add column if not exists vendor text not null default '';
