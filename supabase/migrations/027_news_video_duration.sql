-- ==============================================================================
-- 027_news_video_duration.sql
-- Adds real YouTube video duration tracking columns to public.news.
-- Both columns are nullable so existing/non-video news rows continue working.
-- ==============================================================================

ALTER TABLE public.news
    ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER;

ALTER TABLE public.news
    ADD COLUMN IF NOT EXISTS video_duration_checked_at TIMESTAMPTZ;
