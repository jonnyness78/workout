import { createClient } from '@supabase/supabase-js';

type Exercise = { id: string; name: string; muscle: string };
type WorkoutTemplate = { id: string; name: string; exercises: Exercise[] };
type WorkoutSession = {
  id: string;
  date: string;
  templateId: string;
  templateName: string;
  exercises: Array<{ id: string; name: string; muscle: string; sets: Array<{ weight: number; reps: number }> }>;
};
type BodyMetricsEntry = { date: string; weight: number; bodyFat: number };

type TemplateRow = {
  id: string;
  client_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type TemplateExerciseRow = {
  id: string;
  template_id: string;
  client_id: string;
  exercise_name: string;
  muscle_name: string;
  sort_order: number;
};

type SessionRow = {
  id: string;
  client_id: string;
  performed_at: string;
  template_id: null | string;
  template_name: string;
  created_at: string;
};

type SessionExerciseRow = {
  id: string;
  session_id: string;
  client_id: string;
  exercise_name: string;
  muscle_name: string;
  sort_order: number;
};

type SessionSetRow = {
  id: string;
  session_exercise_id: string;
  client_id: string;
  weight: number;
  reps: number;
  set_order: number;
};

type BodyMetricRow = {
  id: string;
  client_id: string;
  recorded_at: string;
  weight: number;
  body_fat: number;
};

type MuscleRow = {
  id: string;
  client_id: string;
  slug: string;
  name: string;
  is_custom: boolean;
  created_at: string;
};

export type RemoteSnapshot = {
  muscles: string[];
  templates: WorkoutTemplate[];
  sessions: WorkoutSession[];
  metrics: BodyMetricsEntry[];
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CLIENT_ID_KEY = 'lift-log-client-id';

export const DEFAULT_MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'quads',
  'glutes',
  'calves'
] as const;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function invariantClient() {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  return supabase;
}

export function normalizeMuscleName(name: string) {
  return name.trim().toLowerCase();
}

export function slugifyMuscleName(name: string) {
  return normalizeMuscleName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatMuscleLabel(name: string) {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function sortMuscleNames(names: string[]) {
  const normalized = Array.from(new Set(names.map(normalizeMuscleName).filter(Boolean)));
  const defaultOrder = DEFAULT_MUSCLES.map((muscle) => muscle.toString());
  const custom = normalized.filter((name) => !defaultOrder.includes(name)).sort((a, b) => a.localeCompare(b));
  return [...defaultOrder.filter((name) => normalized.includes(name)), ...custom];
}

export function getClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

function groupRows<T extends { [key: string]: unknown }>(rows: T[], key: keyof T) {
  return rows.reduce((map, row) => {
    const groupKey = String(row[key]);
    const bucket = map.get(groupKey);
    if (bucket) bucket.push(row);
    else map.set(groupKey, [row]);
    return map;
  }, new Map<string, T[]>());
}

async function selectAll<T>(table: string, columns: string, clientId: string, orderColumn: string, ascending = true) {
  const client = invariantClient();
  const { data, error } = await client.from(table).select(columns).eq('client_id', clientId).order(orderColumn, { ascending });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function ensureDefaultMuscles() {
  const client = invariantClient();
  const clientId = getClientId();
  const rows = DEFAULT_MUSCLES.map((muscle) => ({
    client_id: clientId,
    slug: slugifyMuscleName(muscle),
    name: muscle,
    is_custom: false
  }));
  const { error } = await client.from('muscles').upsert(rows, { onConflict: 'client_id,slug' });
  if (error) throw error;
}

export async function loadRemoteSnapshot(): Promise<RemoteSnapshot> {
  const clientId = getClientId();

  const [muscleRows, templateRows, metricRows, sessionRows] = await Promise.all([
    selectAll<MuscleRow>('muscles', 'id, client_id, slug, name, is_custom, created_at', clientId, 'created_at'),
    selectAll<TemplateRow>('workout_templates', 'id, client_id, name, created_at, updated_at', clientId, 'updated_at', false),
    selectAll<BodyMetricRow>('body_metrics', 'id, client_id, recorded_at, weight, body_fat', clientId, 'recorded_at', false),
    selectAll<SessionRow>('workout_sessions', 'id, client_id, performed_at, template_id, template_name, created_at', clientId, 'performed_at', false)
  ]);

  const client = invariantClient();
  const templateIds = templateRows.map((row) => row.id);
  const sessionIds = sessionRows.map((row) => row.id);

  const [templateExerciseRows, sessionExerciseRows] = await Promise.all([
    templateIds.length
      ? client
          .from('template_exercises')
          .select('id, template_id, client_id, exercise_name, muscle_name, sort_order')
          .eq('client_id', clientId)
          .in('template_id', templateIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? client
          .from('session_exercises')
          .select('id, session_id, client_id, exercise_name, muscle_name, sort_order')
          .eq('client_id', clientId)
          .in('session_id', sessionIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (templateExerciseRows.error) throw templateExerciseRows.error;
  if (sessionExerciseRows.error) throw sessionExerciseRows.error;

  const sessionExerciseIds = (sessionExerciseRows.data ?? []).map((row) => row.id);
  const sessionSetRows = sessionExerciseIds.length
    ? await client
        .from('session_sets')
        .select('id, session_exercise_id, client_id, weight, reps, set_order')
        .eq('client_id', clientId)
        .in('session_exercise_id', sessionExerciseIds)
        .order('set_order', { ascending: true })
    : { data: [], error: null };

  if (sessionSetRows.error) throw sessionSetRows.error;

  const templateExercisesByTemplate = groupRows((templateExerciseRows.data ?? []) as TemplateExerciseRow[], 'template_id');
  const sessionExercisesBySession = groupRows((sessionExerciseRows.data ?? []) as SessionExerciseRow[], 'session_id');
  const sessionSetsByExercise = groupRows((sessionSetRows.data ?? []) as SessionSetRow[], 'session_exercise_id');

  const templates: WorkoutTemplate[] = templateRows.map((template) => ({
    id: template.id,
    name: template.name,
    exercises: (templateExercisesByTemplate.get(template.id) ?? []).map((exercise) => ({
      id: exercise.id,
      name: exercise.exercise_name,
      muscle: normalizeMuscleName(exercise.muscle_name)
    }))
  }));

  const sessions: WorkoutSession[] = sessionRows.map((session) => ({
    id: session.id,
    date: session.performed_at,
    templateId: session.template_id ?? '',
    templateName: session.template_name,
    exercises: (sessionExercisesBySession.get(session.id) ?? []).map((exercise) => ({
      id: exercise.id,
      name: exercise.exercise_name,
      muscle: normalizeMuscleName(exercise.muscle_name),
      sets: (sessionSetsByExercise.get(exercise.id) ?? []).map((set) => ({
        weight: Number(set.weight),
        reps: Number(set.reps)
      }))
    }))
  }));

  const metrics: BodyMetricsEntry[] = metricRows.map((metric) => ({
    date: metric.recorded_at,
    weight: Number(metric.weight),
    bodyFat: Number(metric.body_fat)
  }));

  return {
    muscles: sortMuscleNames(muscleRows.map((row) => row.name)),
    templates,
    sessions,
    metrics
  };
}

export async function saveMuscleRecord(name: string) {
  const client = invariantClient();
  const normalized = normalizeMuscleName(name);
  if (!normalized) return;
  const { error } = await client.from('muscles').upsert(
    {
      client_id: getClientId(),
      slug: slugifyMuscleName(normalized),
      name: normalized,
      is_custom: !DEFAULT_MUSCLES.includes(normalized as (typeof DEFAULT_MUSCLES)[number])
    },
    { onConflict: 'client_id,slug' }
  );
  if (error) throw error;
}

export async function saveTemplateRecord(template: WorkoutTemplate) {
  const client = invariantClient();
  const clientId = getClientId();

  const { error: templateError } = await client.from('workout_templates').upsert(
    {
      id: template.id,
      client_id: clientId,
      name: template.name
    },
    { onConflict: 'id' }
  );

  if (templateError) throw templateError;

  const { error: deleteError } = await client.from('template_exercises').delete().eq('client_id', clientId).eq('template_id', template.id);
  if (deleteError) throw deleteError;

  const exerciseRows = template.exercises.map((exercise, index) => ({
    id: exercise.id,
    template_id: template.id,
    client_id: clientId,
    exercise_name: exercise.name,
    muscle_name: normalizeMuscleName(exercise.muscle),
    sort_order: index
  }));

  if (exerciseRows.length) {
    const { error: insertError } = await client.from('template_exercises').insert(exerciseRows);
    if (insertError) throw insertError;
  }

  const muscleNames = template.exercises.map((exercise) => exercise.muscle);
  await Promise.all(muscleNames.map((muscle) => saveMuscleRecord(muscle)));
}

export async function deleteTemplateRecord(templateId: string) {
  const client = invariantClient();
  const { error } = await client.from('workout_templates').delete().eq('client_id', getClientId()).eq('id', templateId);
  if (error) throw error;
}

export async function saveBodyMetricRecord(entry: BodyMetricsEntry) {
  const client = invariantClient();
  const { error } = await client.from('body_metrics').insert({
    client_id: getClientId(),
    recorded_at: entry.date,
    weight: entry.weight,
    body_fat: entry.bodyFat
  });
  if (error) throw error;
}

export async function saveWorkoutSessionRecord(session: WorkoutSession) {
  const client = invariantClient();
  const clientId = getClientId();

  const { error: sessionError } = await client.from('workout_sessions').insert({
    id: session.id,
    client_id: clientId,
    performed_at: session.date,
    template_id: session.templateId || null,
    template_name: session.templateName
  });
  if (sessionError) throw sessionError;

  const sessionExercises = session.exercises.map((exercise, index) => ({
    id: exercise.id,
    session_id: session.id,
    client_id: clientId,
    exercise_name: exercise.name,
    muscle_name: normalizeMuscleName(exercise.muscle),
    sort_order: index
  }));

  if (sessionExercises.length) {
    const { error: exerciseError } = await client.from('session_exercises').insert(sessionExercises);
    if (exerciseError) throw exerciseError;
  }

  const sessionSets = session.exercises.flatMap((exercise) =>
    exercise.sets.map((set, index) => ({
      session_exercise_id: exercise.id,
      client_id: clientId,
      weight: set.weight,
      reps: set.reps,
      set_order: index
    }))
  );

  if (sessionSets.length) {
    const { error: setError } = await client.from('session_sets').insert(sessionSets);
    if (setError) throw setError;
  }

  const muscleNames = session.exercises.map((exercise) => exercise.muscle);
  await Promise.all(muscleNames.map((muscle) => saveMuscleRecord(muscle)));
}
