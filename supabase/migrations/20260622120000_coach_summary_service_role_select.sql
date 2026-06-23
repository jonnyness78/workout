-- Support the read-only coach-summary endpoint by allowing service_role to read workout history.
grant select on public.workout_sessions to service_role;
grant select on public.session_exercises to service_role;
grant select on public.session_sets to service_role;
