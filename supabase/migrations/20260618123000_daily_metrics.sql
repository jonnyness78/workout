-- Adds daily recovery metrics without changing any existing workout tables.

create extension if not exists pgcrypto;

create table if not exists public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  recorded_on date not null,
  steps integer,
  distance_walked_meters numeric(10,2),
  active_calories_kcal integer,
  intentional_exercise_minutes integer,
  sleep_minutes integer,
  resting_heart_rate_bpm smallint,
  hrv_ms numeric(6,2),
  recovery_score smallint,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_metrics_client_recorded_on_key unique (client_id, recorded_on),
  constraint daily_metrics_steps_nonnegative check (steps is null or steps >= 0),
  constraint daily_metrics_distance_walked_meters_nonnegative check (distance_walked_meters is null or distance_walked_meters >= 0),
  constraint daily_metrics_active_calories_nonnegative check (active_calories_kcal is null or active_calories_kcal >= 0),
  constraint daily_metrics_intentional_exercise_minutes_nonnegative check (intentional_exercise_minutes is null or intentional_exercise_minutes >= 0),
  constraint daily_metrics_sleep_minutes_nonnegative check (sleep_minutes is null or sleep_minutes >= 0),
  constraint daily_metrics_resting_heart_rate_positive check (resting_heart_rate_bpm is null or resting_heart_rate_bpm > 0),
  constraint daily_metrics_hrv_ms_nonnegative check (hrv_ms is null or hrv_ms >= 0),
  constraint daily_metrics_recovery_score_nonnegative check (recovery_score is null or recovery_score >= 0)
);

create index if not exists daily_metrics_client_id_idx on public.daily_metrics(client_id);
create index if not exists daily_metrics_recorded_on_idx on public.daily_metrics(recorded_on desc);

drop trigger if exists daily_metrics_set_updated_at on public.daily_metrics;
create trigger daily_metrics_set_updated_at
before update on public.daily_metrics
for each row
execute function public.set_updated_at();

alter table public.daily_metrics enable row level security;

grant select, insert, update, delete on public.daily_metrics to anon, authenticated;

drop policy if exists "daily_metrics_public_access" on public.daily_metrics;
create policy "daily_metrics_public_access" on public.daily_metrics for all to anon, authenticated using (true) with check (true);
