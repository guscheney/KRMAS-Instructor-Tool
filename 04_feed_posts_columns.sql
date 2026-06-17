-- 04_feed_posts_columns.sql  —  run ONCE in the Supabase SQL Editor.
-- ----------------------------------------------------------------------------
-- Fixes: "posts publish but don't save".
-- The app writes notice_type / required_reading / expires_at on EVERY feed post
-- (they default to null/false for ordinary posts), but these columns were never
-- added to the production feed_posts table. Postgres therefore rejected every
-- insert with `42703 column "notice_type" does not exist`, and the client logged
-- the error and carried on — so the post appeared (optimistic UI) but never saved,
-- and vanished on reload.
--
-- Idempotent: safe to run even if the columns already exist.
-- ----------------------------------------------------------------------------
alter table public.feed_posts add column if not exists notice_type      text;
alter table public.feed_posts add column if not exists required_reading boolean not null default false;
alter table public.feed_posts add column if not exists expires_at       date;

-- Verify (optional): all three should be listed.
-- select column_name from information_schema.columns
--  where table_name = 'feed_posts'
--    and column_name in ('notice_type','required_reading','expires_at');
