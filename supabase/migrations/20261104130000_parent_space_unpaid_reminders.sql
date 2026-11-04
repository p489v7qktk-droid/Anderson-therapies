alter table public.parent_space_bookings
    add column reminder_sent_at timestamptz;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The schedule itself is created separately because it contains a secret; see supabase/README.md.
