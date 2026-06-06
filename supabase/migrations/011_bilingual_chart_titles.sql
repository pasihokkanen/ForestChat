-- 011_rename_chart_title.sql
-- Rename chart_tabs.title → title_en, add title_fi for bilingual chart titles

ALTER TABLE chart_tabs RENAME COLUMN title TO title_en;
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS title_fi TEXT;
