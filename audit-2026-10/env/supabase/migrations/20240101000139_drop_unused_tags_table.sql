-- The `tags` table (Master Data → Tags) was seeded early in development
-- (migration 026) but nothing was ever built to consume it: no other table
-- has a foreign key to it, and no screen anywhere lets a request/task/
-- service actually be tagged with one. It was pure admin bookkeeping with
-- no downstream effect — removed at the user's request rather than leaving
-- dead functionality in the product. DROP TABLE cascades its own RLS
-- policies automatically.
DROP TABLE IF EXISTS tags;
