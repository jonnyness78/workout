import { createClient } from "npm:@supabase/supabase-js@2";

type SessionRow = {
  id: string;
  client_id: string;
  performed_at: string;
  template_id: string | null;
  template_name: string;
  created_at: string;
};

type SessionExerciseRow = {
  id: string;
  session_id: string;
  exercise_name: string;
  muscle_name: string;
  sort_order: number;
};

type SessionSetRow = {
  id: string;
  session_exercise_id: string;
  weight: number;
  reps: number;
  set_order: number;
};

type DailyMetricRow = {
  client_id: string;
  recorded_on: string;
  steps: number | null;
  distance_walked_meters: number | null;
  active_calories_kcal: number | null;
  intentional_exercise_minutes: number | null;
  sleep_minutes: number | null;
  resting_heart_rate_bpm: number | null;
  hrv_ms: number | null;
  recovery_score: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function parseClientId(url: URL, payload: unknown) {
  const fromQuery = url.searchParams.get("client_id");
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  if (payload && typeof payload === "object" && "client_id" in payload) {
    const value = (payload as { client_id?: unknown }).client_id;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function unauthorized() {
  return json({ error: "Unauthorized." }, 401);
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : null;
}

function latest<T>(items: T[], getDate: (item: T) => string) {
  return [...items].sort((a, b) => getDate(b).localeCompare(getDate(a)))[0] ?? null;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(a: string, b: string) {
  const first = startOfDay(new Date(a)).getTime();
  const second = startOfDay(new Date(b)).getTime();
  return Math.round((second - first) / 86_400_000);
}

function derivePrimaryExercises(exercises: Array<{ name: string; volume: number }>) {
  return [...exercises]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3)
    .map((exercise) => exercise.name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const coachSummaryApiKey = Deno.env.get("COACH_SUMMARY_API_KEY");
  const requestApiKey = req.headers.get("x-api-key");

  if (!coachSummaryApiKey || requestApiKey !== coachSummaryApiKey) {
    return unauthorized();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase environment variables are not configured." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let body: unknown = null;
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = null;
    }
  }

  const url = new URL(req.url);
  const clientId = parseClientId(url, body);
  if (!clientId) {
    return json({ error: "client_id is required." }, 400);
  }

  const [sessionsResult, exercisesResult, setsResult, metricsResult] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select("id, client_id, performed_at, template_id, template_name, created_at")
      .eq("client_id", clientId)
      .order("performed_at", { ascending: false })
      .limit(10),
    supabase
      .from("session_exercises")
      .select("id, session_id, exercise_name, muscle_name, sort_order")
      .eq("client_id", clientId),
    supabase
      .from("session_sets")
      .select("id, session_exercise_id, weight, reps, set_order")
      .eq("client_id", clientId),
    supabase
      .from("daily_metrics")
      .select(
        "client_id, recorded_on, steps, distance_walked_meters, active_calories_kcal, intentional_exercise_minutes, sleep_minutes, resting_heart_rate_bpm, hrv_ms, recovery_score"
      )
      .eq("client_id", clientId)
      .order("recorded_on", { ascending: false })
      .limit(30)
  ]);

  if (sessionsResult.error) return json({ error: sessionsResult.error.message }, 400);
  if (exercisesResult.error) return json({ error: exercisesResult.error.message }, 400);
  if (setsResult.error) return json({ error: setsResult.error.message }, 400);
  if (metricsResult.error) return json({ error: metricsResult.error.message }, 400);

  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const exercises = (exercisesResult.data ?? []) as SessionExerciseRow[];
  const sets = (setsResult.data ?? []) as SessionSetRow[];
  const metrics = (metricsResult.data ?? []) as DailyMetricRow[];

  const exercisesBySession = exercises.reduce<Record<string, SessionExerciseRow[]>>((acc, exercise) => {
    (acc[exercise.session_id] ??= []).push(exercise);
    return acc;
  }, {});

  const setsByExercise = sets.reduce<Record<string, SessionSetRow[]>>((acc, set) => {
    (acc[set.session_exercise_id] ??= []).push(set);
    return acc;
  }, {});

  const workoutSummaries = sessions.map((session) => {
    const sessionExercises = (exercisesBySession[session.id] ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((exercise) => {
        const sessionSets = (setsByExercise[exercise.id] ?? []).sort((a, b) => a.set_order - b.set_order);
        const exerciseVolume = sessionSets.reduce((total, set) => total + Number(set.weight) * Number(set.reps), 0);
        return {
          name: exercise.exercise_name,
          muscle: exercise.muscle_name,
          set_count: sessionSets.length,
          volume: round(exerciseVolume, 1)
        };
      });

    const volume = round(sessionExercises.reduce((total, exercise) => total + exercise.volume, 0), 1);
    const primaryExercises = derivePrimaryExercises(sessionExercises);

    return {
      workout_date: session.performed_at.slice(0, 10),
      template_name: session.template_name,
      exercise_count: sessionExercises.length,
      primary_exercises: primaryExercises,
      volume_lbs: volume,
      duration_minutes: null,
      notes: []
    };
  });

  const workoutDates = workoutSummaries.map((workout) => workout.workout_date);
  const totalWorkouts = workoutSummaries.length;
  const activeSpanDays = workoutDates.length >= 2 ? daysBetween(workoutDates[workoutDates.length - 1], workoutDates[0]) : null;
  const workoutFrequencyPerWeek = activeSpanDays && activeSpanDays > 0 ? round((totalWorkouts / activeSpanDays) * 7, 2) : null;
  const averageWorkoutVolume = average(workoutSummaries.map((workout) => workout.volume_lbs));
  const latestWorkout = latest(workoutSummaries, (workout) => workout.workout_date);
  const previousWorkout = workoutSummaries[1] ?? null;
  const volumeTrend =
    latestWorkout && previousWorkout
      ? {
          current_volume_lbs: latestWorkout.volume_lbs,
          previous_volume_lbs: previousWorkout.volume_lbs,
          change_lbs: round(latestWorkout.volume_lbs - previousWorkout.volume_lbs, 1)
        }
      : null;

  const lastHealthSync = metrics[0]?.recorded_on ?? null;
  const recentSevenDays = metrics.slice(0, 7);
  const latestRecoveryMetric = metrics[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const daysSinceLastWorkout = latestWorkout ? daysBetween(latestWorkout.workout_date, today) : null;

  const stepValues = metrics.map((metric) => metric.steps).filter((value): value is number => typeof value === "number");
  const sleepValues = metrics.map((metric) => metric.sleep_minutes).filter((value): value is number => typeof value === "number");
  const hrvValues = metrics.map((metric) => metric.hrv_ms).filter((value): value is number => typeof value === "number");
  const rhrValues = metrics.map((metric) => metric.resting_heart_rate_bpm).filter((value): value is number => typeof value === "number");
  const recoveryValues = metrics.map((metric) => metric.recovery_score).filter((value): value is number => typeof value === "number");
  const recentStepValues = recentSevenDays.map((metric) => metric.steps).filter((value): value is number => typeof value === "number");
  const recentSleepValues = recentSevenDays.map((metric) => metric.sleep_minutes).filter((value): value is number => typeof value === "number");
  const workoutsLast7Days = workoutSummaries.filter((workout) => {
    const workoutDate = workout.workout_date;
    return daysBetween(workoutDate, today) <= 6 && daysBetween(workoutDate, today) >= 0;
  }).length;

  const response = {
    version: 1,
    client_id: clientId,
    generated_at: new Date().toISOString(),
    last_health_sync: lastHealthSync,
    coaching_context: {
      days_since_last_workout: daysSinceLastWorkout,
      workouts_last_7_days: workoutsLast7Days,
      average_steps_last_7_days: recentStepValues.length ? Math.round(sum(recentStepValues) / recentStepValues.length) : null,
      average_sleep_minutes_last_7_days: recentSleepValues.length ? round(sum(recentSleepValues) / recentSleepValues.length, 1) : null,
      latest_recovery_score: latestRecoveryMetric?.recovery_score ?? null
    },
    workout_summary: {
      recent_workouts: workoutSummaries,
      workout_dates: workoutDates,
      volume_trend: volumeTrend,
      average_volume_lbs: averageWorkoutVolume !== null ? round(averageWorkoutVolume, 1) : null,
      workout_count: totalWorkouts,
      workout_frequency_per_week: workoutFrequencyPerWeek,
      consistency: {
        active_span_days: activeSpanDays,
        workouts_per_week: workoutFrequencyPerWeek
      }
    },
    recovery_summary: {
      recent_daily_metrics: metrics.slice(0, 14).map((metric) => ({
        recorded_on: metric.recorded_on,
        steps: metric.steps,
        distance_walked_meters: metric.distance_walked_meters,
        active_calories_kcal: metric.active_calories_kcal,
        intentional_exercise_minutes: metric.intentional_exercise_minutes,
        sleep_minutes: metric.sleep_minutes,
        resting_heart_rate_bpm: metric.resting_heart_rate_bpm,
        hrv_ms: metric.hrv_ms,
        recovery_score: metric.recovery_score
      })),
      averages: {
        steps: average(stepValues) !== null ? Math.round(average(stepValues) as number) : null,
        sleep_minutes: average(sleepValues) !== null ? round(average(sleepValues) as number, 1) : null,
        hrv_ms: average(hrvValues) !== null ? round(average(hrvValues) as number, 2) : null,
        resting_heart_rate_bpm: average(rhrValues) !== null ? round(average(rhrValues) as number, 1) : null,
        recovery_score: average(recoveryValues) !== null ? round(average(recoveryValues) as number, 1) : null
      }
    },
    notes: [
      "Workout duration is unavailable in the current schema, so duration_minutes is null.",
      "Workout notes are unavailable in the current schema, so notes are returned as empty arrays.",
      "Recovery metrics are summarized from daily_metrics only; no raw table dumps are exposed."
    ]
  };

  return json(response, 200);
});
