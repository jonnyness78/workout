import { createClient } from "npm:@supabase/supabase-js@2";

type DailyMetricsPayload = {
  client_id: string;
  recorded_on: string;
  steps?: number | string | null;
  distance_walked_meters?: number | string | null;
  active_calories_kcal?: number | string | null;
  intentional_exercise_minutes?: number | string | null;
  sleep_minutes?: number | string | null;
  resting_heart_rate_bpm?: number | string | null;
  hrv_ms?: number | string | null;
  recovery_score?: number | string | null;
  notes?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("recorded_on must be a YYYY-MM-DD string.");
  }
  return value;
}

function parseRequiredClientId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("client_id is required.");
  }
  return value.trim();
}

function parseOptionalInteger(value: unknown, field: string, allowZero = true) {
  if (value === undefined || value === "") return undefined;
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer.`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw new Error(`${field} must be ${allowZero ? "non-negative" : "positive"}.`);
  }
  return parsed;
}

function parseOptionalDecimal(value: unknown, field: string) {
  if (value === undefined || value === "") return undefined;
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a number.`);
  }
  if (parsed < 0) {
    throw new Error(`${field} must be non-negative.`);
  }
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const shortcutApiKey = Deno.env.get("SHORTCUT_API_KEY");
  const requestApiKey = req.headers.get("x-api-key");

  if (!shortcutApiKey || !requestApiKey || requestApiKey !== shortcutApiKey) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase environment variables are not configured." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let payload: DailyMetricsPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  try {
    const clientId = parseRequiredClientId(payload.client_id);
    const recordedOn = parseDate(payload.recorded_on);

    const record: Record<string, string | number | null> = {
      client_id: clientId,
      recorded_on: recordedOn
    };

    const steps = parseOptionalInteger(payload.steps, "steps");
    const distanceWalkedMeters = parseOptionalDecimal(payload.distance_walked_meters, "distance_walked_meters");
    const activeCaloriesKcal = parseOptionalInteger(payload.active_calories_kcal, "active_calories_kcal");
    const intentionalExerciseMinutes = parseOptionalInteger(payload.intentional_exercise_minutes, "intentional_exercise_minutes");
    const sleepMinutes = parseOptionalInteger(payload.sleep_minutes, "sleep_minutes");
    const restingHeartRateBpm = parseOptionalInteger(payload.resting_heart_rate_bpm, "resting_heart_rate_bpm", false);
    const hrvMs = parseOptionalDecimal(payload.hrv_ms, "hrv_ms");
    const recoveryScore = parseOptionalInteger(payload.recovery_score, "recovery_score");

    if (steps !== undefined) record.steps = steps;
    if (distanceWalkedMeters !== undefined) record.distance_walked_meters = distanceWalkedMeters;
    if (activeCaloriesKcal !== undefined) record.active_calories_kcal = activeCaloriesKcal;
    if (intentionalExerciseMinutes !== undefined) record.intentional_exercise_minutes = intentionalExerciseMinutes;
    if (sleepMinutes !== undefined) record.sleep_minutes = sleepMinutes;
    if (restingHeartRateBpm !== undefined) record.resting_heart_rate_bpm = restingHeartRateBpm;
    if (hrvMs !== undefined) record.hrv_ms = hrvMs;
    if (recoveryScore !== undefined) record.recovery_score = recoveryScore;
    if (payload.notes !== undefined) {
      if (payload.notes !== null && typeof payload.notes !== "string") {
        throw new Error("notes must be a string or null.");
      }
      record.notes = payload.notes;
    }

    const { data, error } = await supabase
      .from("daily_metrics")
      .upsert(record, { onConflict: "client_id,recorded_on" })
      .select("id, client_id, recorded_on, steps, distance_walked_meters, active_calories_kcal, intentional_exercise_minutes, sleep_minutes, resting_heart_rate_bpm, hrv_ms, recovery_score, notes, created_at, updated_at")
      .single();

    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({ ok: true, data }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return json({ error: message }, 400);
  }
});
