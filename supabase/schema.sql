-- Workspace persistence for react-dev.
-- Run this in the Supabase dashboard → SQL Editor → New query → Run.
--
-- One row per user. `document` holds the DataSet (files/content/layouts);
-- `theme` holds { themeId, accentHex }. Row-level security ties every row to
-- the signed-in user, so the public anon key can never read another user's data.

create table if not exists public.workspaces (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    document   jsonb,
    theme      jsonb,
    updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- A user can only see and write their own row. auth.uid() is the id of the
-- currently signed-in user, injected by Supabase on every request.
create policy "Users read own workspace"
    on public.workspaces for select
    using (auth.uid() = user_id);

create policy "Users insert own workspace"
    on public.workspaces for insert
    with check (auth.uid() = user_id);

create policy "Users update own workspace"
    on public.workspaces for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
