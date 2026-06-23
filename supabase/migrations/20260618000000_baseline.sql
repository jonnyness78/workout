-- Baseline migration for Lift Log.
-- This mirrors the existing production schema exactly so migration history can
-- start from the current live database without changing any tables.

create extension if not exists pgcrypto;

create table if not exists public.muscles (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  slug text not null,
  name text not null,
  is_custom boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (client_id, slug)
);

create table if not exists public.workout_templates (
  id uuid primary key,
  client_id text not null,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.template_exercises (
  id uuid primary key,
  template_id uuid not null references public.workout_templates(id) on delete cascade,
  client_id text not null,
  exercise_name text not null,
  muscle_name text not null,
  sort_order integer not null default 0
);

create table if not exists public.workout_sessions (
  id uuid primary key,
  client_id text not null,
  performed_at timestamptz not null,
  template_id uuid,
  template_name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.session_exercises (
  id uuid primary key,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  client_id text not null,
  exercise_name text not null,
  muscle_name text not null,
  sort_order integer not null default 0
);

create table if not exists public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  client_id text not null,
  weight numeric not null,
  reps integer not null,
  set_order integer not null default 0
);

create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  recorded_at timestamptz not null,
  weight numeric not null,
  body_fat numeric not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists muscles_client_id_idx on public.muscles(client_id);
create index if not exists workout_templates_client_id_idx on public.workout_templates(client_id);
create index if not exists template_exercises_template_id_idx on public.template_exercises(template_id);
create index if not exists template_exercises_client_id_idx on public.template_exercises(client_id);
create index if not exists workout_sessions_client_id_idx on public.workout_sessions(client_id);
create index if not exists workout_sessions_performed_at_idx on public.workout_sessions(performed_at desc);
create index if not exists session_exercises_session_id_idx on public.session_exercises(session_id);
create index if not exists session_exercises_client_id_idx on public.session_exercises(client_id);
create index if not exists session_sets_session_exercise_id_idx on public.session_sets(session_exercise_id);
create index if not exists session_sets_client_id_idx on public.session_sets(client_id);
create index if not exists body_metrics_client_id_idx on public.body_metrics(client_id);
create index if not exists body_metrics_recorded_at_idx on public.body_metrics(recorded_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists workout_templates_set_updated_at on public.workout_templates;
create trigger workout_templates_set_updated_at
before update on public.workout_templates
for each row
execute function public.set_updated_at();

alter table public.muscles enable row level security;
alter table public.workout_templates enable row level security;
alter table public.template_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.session_sets enable row level security;
alter table public.body_metrics enable row level security;

grant select, insert, update, delete on public.muscles to anon, authenticated;
grant select, insert, update, delete on public.workout_templates to anon, authenticated;
grant select, insert, update, delete on public.template_exercises to anon, authenticated;
grant select, insert, update, delete on public.workout_sessions to anon, authenticated;
grant select, insert, update, delete on public.session_exercises to anon, authenticated;
grant select, insert, update, delete on public.session_sets to anon, authenticated;
grant select, insert, update, delete on public.body_metrics to anon, authenticated;

drop policy if exists "muscles_public_access" on public.muscles;
create policy "muscles_public_access" on public.muscles for all to anon, authenticated using (true) with check (true);

drop policy if exists "workout_templates_public_access" on public.workout_templates;
create policy "workout_templates_public_access" on public.workout_templates for all to anon, authenticated using (true) with check (true);

drop policy if exists "template_exercises_public_access" on public.template_exercises;
create policy "template_exercises_public_access" on public.template_exercises for all to anon, authenticated using (true) with check (true);

drop policy if exists "workout_sessions_public_access" on public.workout_sessions;
create policy "workout_sessions_public_access" on public.workout_sessions for all to anon, authenticated using (true) with check (true);

drop policy if exists "session_exercises_public_access" on public.session_exercises;
create policy "session_exercises_public_access" on public.session_exercises for all to anon, authenticated using (true) with check (true);

drop policy if exists "session_sets_public_access" on public.session_sets;
create policy "session_sets_public_access" on public.session_sets for all to anon, authenticated using (true) with check (true);

drop policy if exists "body_metrics_public_access" on public.body_metrics;
create policy "body_metrics_public_access" on public.body_metrics for all to anon, authenticated using (true) with check (true);
