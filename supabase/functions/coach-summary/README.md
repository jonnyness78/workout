# Coach summary endpoint

This Edge Function returns a compact, read-only JSON coaching surface for an
OpenClaw Personal Trainer agent.

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COACH_SUMMARY_API_KEY`

## Authentication

Requests must include:

`x-api-key: <COACH_SUMMARY_API_KEY>`

The function compares that header to `COACH_SUMMARY_API_KEY` and returns `401`
if it is missing or invalid.

## Response Fields

- `version`
- `generated_at`
- `last_health_sync`
- `coaching_context`
- `workout_summary`
- `recovery_summary`

## Sample curl

```bash
curl -sS "https://<project-ref>.supabase.co/functions/v1/coach-summary?client_id=<client-id>" \
  -H "x-api-key: <COACH_SUMMARY_API_KEY>"
```

POST is also supported if you prefer sending JSON:

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/coach-summary" \
  -H "x-api-key: <COACH_SUMMARY_API_KEY>" \
  -H "Content-Type: application/json" \
  --data '{"client_id":"<client-id>"}'
```

## Expected JSON response

The response is intentionally compact and read-only. It includes:

- `version`: response schema version, currently `1`
- `generated_at`: when the summary was generated
- `last_health_sync`: newest `daily_metrics.recorded_on`, or `null`
- `coaching_context`: derived metrics only
- `workout_summary.recent_workouts`: compact workout summaries
- `workout_summary.workout_dates`
- `workout_summary.volume_trend`
- `workout_summary.consistency`
- `recovery_summary.recent_daily_metrics`
- `recovery_summary.averages`

Example shape:

```json
{
  "version": 1,
  "client_id": "client-123",
  "generated_at": "2026-06-21T18:00:00.000Z",
  "last_health_sync": "2026-06-20",
  "coaching_context": {
    "days_since_last_workout": 2,
    "workouts_last_7_days": 4,
    "average_steps_last_7_days": 9314,
    "average_sleep_minutes_last_7_days": 430,
    "latest_recovery_score": 82
  },
  "workout_summary": {
    "recent_workouts": [
      {
        "workout_date": "2026-06-20",
        "template_name": "Push",
        "exercise_count": 3,
        "primary_exercises": [
          "Bench Press",
          "Incline Dumbbell Press",
          "Shoulder Press"
        ],
        "volume_lbs": 18120,
        "duration_minutes": null,
        "notes": []
      }
    ],
    "workout_dates": ["2026-06-20"],
    "volume_trend": null,
    "average_volume_lbs": 18120,
    "workout_count": 1,
    "workout_frequency_per_week": null,
    "consistency": {
      "active_span_days": null,
      "workouts_per_week": null
    }
  },
  "recovery_summary": {
    "recent_daily_metrics": [
      {
        "recorded_on": "2026-06-20",
        "steps": 12345,
        "distance_walked_meters": 8123.5,
        "active_calories_kcal": 450,
        "intentional_exercise_minutes": 60,
        "sleep_minutes": 420,
        "resting_heart_rate_bpm": 58,
        "hrv_ms": 82.4,
        "recovery_score": 74
      }
    ],
    "averages": {
      "steps": 12345,
      "sleep_minutes": 420,
      "hrv_ms": 82.4,
      "resting_heart_rate_bpm": 58,
      "recovery_score": 74
    }
  },
  "notes": [
    "Workout duration is unavailable in the current schema, so duration_minutes is null.",
    "Workout notes are unavailable in the current schema, so notes are returned as empty arrays.",
    "Recovery metrics are summarized from daily_metrics only; no raw table dumps are exposed."
  ]
}
```

## Deployment instructions

1. Set the secret:
   `supabase secrets set COACH_SUMMARY_API_KEY="<secret>" --project-ref <project-ref>`
2. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set for the project.
3. Deploy the function:
   `supabase functions deploy coach-summary --project-ref <project-ref>`
4. Call the endpoint with the `x-api-key` header.

## Compatibility notes

- This is an incremental revision of the existing endpoint.
- The endpoint remains read-only.
- The workout app write paths are unchanged.
- The Apple Health `daily-metrics` flow remains unchanged and still uses `SHORTCUT_API_KEY`.
