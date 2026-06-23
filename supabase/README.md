# Supabase migrations

This project now tracks database changes in `supabase/migrations/`.

## Current baseline

`supabase/migrations/20260618000000_baseline.sql` is a historical snapshot of the
current production schema. It should not be edited unless we are intentionally
re-baselining the entire database.

## How to make future schema changes

1. Create a new migration file with a timestamped name, for example:
   `supabase/migrations/20260618143000_add_workout_notes.sql`
2. Put only the new schema change in that file.
3. Apply it locally with the Supabase CLI:
   `supabase db reset`
4. Push it to the linked Supabase project when ready:
   `supabase db push`

## Existing database history

Because the live database already contains the baseline schema, the baseline
migration should be marked as already applied in migration history when the
project is linked to Supabase for the first time. That keeps the versioned
migration chain aligned with production without re-running the bootstrap SQL.

Typical one-time command:

`supabase migration repair --status applied 20260618000000`

After that, every new change should ship as its own migration file.
