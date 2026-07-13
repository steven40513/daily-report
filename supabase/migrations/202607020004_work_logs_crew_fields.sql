-- 擴充 work_logs，支援「工別紀錄」合併人員與施工內容。
-- 三個欄位皆可為空：舊版寫入的既有資料、以及非工別紀錄情境下不會有值。

alter table public.work_logs
  add column crew_category text,
  add column crew_subtype text,
  add column headcount integer;

alter table public.work_logs
  add constraint work_logs_headcount_non_negative
  check (headcount is null or headcount >= 0);
