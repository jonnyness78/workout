import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MUSCLES,
  deleteTemplateRecord,
  formatMuscleLabel,
  isSupabaseConfigured,
  loadRemoteSnapshot,
  normalizeMuscleName,
  saveBodyMetricRecord,
  saveMuscleRecord,
  saveTemplateRecord,
  saveWorkoutSessionRecord,
  sortMuscleNames
} from './supabase';

type MuscleGroup = string;
type Exercise = { id: string; name: string; muscle: MuscleGroup };
type WorkoutTemplate = { id: string; name: string; exercises: Exercise[] };
type LiveSet = { id: string; weight: string; reps: string; done: boolean };
type BodyMetricsEntry = { date: string; weight: number; bodyFat: number };
type ExerciseHistoryEntry = {
  key: string;
  name: string;
  muscle: MuscleGroup;
  date: string;
  sets: Array<{ weight: number; reps: number }>;
};
type WorkoutSession = {
  id: string;
  date: string;
  templateId: string;
  templateName: string;
  exercises: Array<{ id: string; name: string; muscle: MuscleGroup; sets: Array<{ weight: number; reps: number }> }>;
};
type LiveWorkout = {
  id: string;
  templateId: string;
  templateName: string;
  exercises: Array<{ id: string; name: string; muscle: MuscleGroup; sets: LiveSet[] }>;
};
type ExerciseSeed = { name: string; muscle: MuscleGroup };

const STORAGE_KEY = 'lift-log-mvp';
const LIVE_SESSION_KEY = 'lift-log-live-session';
const METRICS_KEY = 'lift-log-body-metrics';
const MUSCLES_KEY = 'lift-log-muscles';
const BASE_URL = import.meta.env.BASE_URL;
const DEFAULT_SET_COUNT = 3;

const uid = () => crypto.randomUUID();

const defaultTemplates: WorkoutTemplate[] = [
  {
    id: uid(),
    name: 'Push',
    exercises: [
      { id: uid(), name: 'Bench Press', muscle: 'chest' },
      { id: uid(), name: 'Shoulder Press', muscle: 'shoulders' },
      { id: uid(), name: 'Triceps Pushdown', muscle: 'triceps' }
    ]
  },
  {
    id: uid(),
    name: 'Pull',
    exercises: [
      { id: uid(), name: 'Barbell Row', muscle: 'back' },
      { id: uid(), name: 'Lat Pulldown', muscle: 'back' },
      { id: uid(), name: 'Bicep Curl', muscle: 'biceps' }
    ]
  }
];

const blankWorkout = (): WorkoutTemplate => ({
  id: uid(),
  name: '',
  exercises: [{ id: uid(), name: '', muscle: 'chest' }]
});

function readMetrics(): BodyMetricsEntry[] {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    return raw ? (JSON.parse(raw) as BodyMetricsEntry[]) : [];
  } catch {
    return [];
  }
}

function saveMetrics(entries: BodyMetricsEntry[]) {
  localStorage.setItem(METRICS_KEY, JSON.stringify(entries));
}

function buildExerciseHistoryFromSessions(sessions: WorkoutSession[]) {
  return sessions
    .map((session) =>
      session.exercises
        .filter((exercise) => exercise.sets.length)
        .map((exercise) => ({
          key: historyKeyForExercise(exercise.name, exercise.muscle),
          name: exercise.name,
          muscle: normalizeMuscleName(exercise.muscle),
          date: session.date,
          sets: exercise.sets
        }))
    )
    .flat()
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index);
}

function readMuscles() {
  try {
    const raw = localStorage.getItem(MUSCLES_KEY);
    if (!raw) return [...DEFAULT_MUSCLES];
    return sortMuscleNames(JSON.parse(raw) as string[]);
  } catch {
    return [...DEFAULT_MUSCLES];
  }
}

function saveMuscles(entries: string[]) {
  localStorage.setItem(MUSCLES_KEY, JSON.stringify(sortMuscleNames(entries)));
}

function sessionVolume(session: WorkoutSession | LiveWorkout) {
  return session.exercises.reduce((total, exercise) => {
    return (
      total +
      exercise.sets.reduce((setTotal, set) => {
        const weight = Number(set.weight);
        const reps = Number(set.reps);
        if (!Number.isFinite(weight) || !Number.isFinite(reps)) return setTotal;
        return setTotal + weight * reps;
      }, 0)
    );
  }, 0);
}

function sessionMuscleVolume(session: WorkoutSession | LiveWorkout) {
  return session.exercises.reduce((totals, exercise) => {
    totals[exercise.muscle] = (totals[exercise.muscle] ?? 0) + exercise.sets.length;
    return totals;
  }, {} as Record<MuscleGroup, number>);
}

function normalizeExerciseKey(name: string) {
  return name.trim().toLowerCase();
}

function historyKeyForExercise(name: string, muscle: MuscleGroup) {
  return `${normalizeExerciseKey(name)}::${muscle}`;
}

function exerciseSummaryFromSets(sets: Array<{ weight: number; reps: number }>) {
  if (!sets.length) return null;
  const last = sets[sets.length - 1];
  return { weight: last.weight, reps: last.reps, setCount: sets.length };
}

function readState(): { templates: WorkoutTemplate[]; sessions: WorkoutSession[]; exerciseHistory: ExerciseHistoryEntry[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { templates: defaultTemplates, sessions: [], exerciseHistory: [] };
    const parsed = JSON.parse(raw);
    const sessions: WorkoutSession[] = Array.isArray(parsed.sessions)
      ? parsed.sessions.map((session: WorkoutSession) => ({
          ...session,
          exercises: session.exercises.map((exercise) => ({
            ...exercise,
            muscle: normalizeMuscleName(exercise.muscle)
          }))
        }))
      : [];
    const exerciseHistory: ExerciseHistoryEntry[] = Array.isArray(parsed.exerciseHistory)
      ? parsed.exerciseHistory.map((entry: ExerciseHistoryEntry) => ({
          ...entry,
          muscle: normalizeMuscleName(entry.muscle),
          key: historyKeyForExercise(entry.name, normalizeMuscleName(entry.muscle))
        }))
      : buildExerciseHistoryFromSessions(sessions);
    return {
      templates: Array.isArray(parsed.templates) && parsed.templates.length
        ? parsed.templates.map((template: WorkoutTemplate) => ({
            ...template,
            exercises: template.exercises.map((exercise) => ({ ...exercise, muscle: normalizeMuscleName(exercise.muscle) }))
          }))
        : defaultTemplates,
      sessions,
      exerciseHistory
    };
  } catch {
    return { templates: defaultTemplates, sessions: [], exerciseHistory: [] };
  }
}

function readLiveSession(): LiveWorkout | null {
  try {
    const raw = localStorage.getItem(LIVE_SESSION_KEY);
    return raw ? (JSON.parse(raw) as LiveWorkout) : null;
  } catch {
    return null;
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getLastExerciseSets(exerciseName: string, muscle: MuscleGroup, history: ExerciseHistoryEntry[]) {
  const target = historyKeyForExercise(exerciseName, muscle);
  const byName = [...history].reverse().find((entry) => entry.key === target);
  if (byName) return byName.sets;

  const byExerciseName = [...history].reverse().find((entry) => normalizeExerciseKey(entry.name) === normalizeExerciseKey(exerciseName));
  if (byExerciseName) return byExerciseName.sets;

  const byMuscle = [...history].reverse().find((entry) => normalizeMuscleName(entry.muscle) === normalizeMuscleName(muscle));
  return byMuscle?.sets ?? [];
}

function getLastExerciseSetCount(exerciseName: string, muscle: MuscleGroup, history: ExerciseHistoryEntry[]) {
  const lastSets = getLastExerciseSets(exerciseName, muscle, history);
  return lastSets.length || DEFAULT_SET_COUNT;
}

function getPreviousExerciseSummary(exerciseName: string, muscle: MuscleGroup, history: ExerciseHistoryEntry[]) {
  const lastSets = getLastExerciseSets(exerciseName, muscle, history);
  if (!lastSets.length) return '';
  const last = lastSets[lastSets.length - 1];
  return `Previous: ${last.weight} x ${last.reps} · ${lastSets.length} sets`;
}

function createLiveExercise(seed: ExerciseSeed, history: ExerciseHistoryEntry[]) {
  const lastSets = getLastExerciseSets(seed.name, seed.muscle, history);
  const setCount = getLastExerciseSetCount(seed.name, seed.muscle, history);
  return {
    id: uid(),
    name: seed.name,
    muscle: seed.muscle,
    sets: Array.from({ length: setCount }, (_, index) => {
      const prev = lastSets[index] ?? lastSets[lastSets.length - 1] ?? null;
      return {
        id: uid(),
        weight: String(prev?.weight ?? ''),
        reps: String(prev?.reps ?? ''),
        done: false
      };
    })
  };
}

function createWorkoutSession(template: WorkoutTemplate, history: ExerciseHistoryEntry[]): LiveWorkout {
  return {
    id: uid(),
    templateId: template.id,
    templateName: template.name,
    exercises: template.exercises.map((exercise) => createLiveExercise(exercise, history))
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
}

export default function App() {
  const [state, setState] = useState(readState);
  const [screen, setScreen] = useState<'dashboard' | 'create' | 'live' | 'stats'>('dashboard');
  const [muscles, setMuscles] = useState<string[]>(() => readMuscles());
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup>('quads');
  const [draft, setDraft] = useState<WorkoutTemplate>(blankWorkout);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [existingExerciseName, setExistingExerciseName] = useState('');
  const [liveExistingExerciseName, setLiveExistingExerciseName] = useState('');
  const [liveNewExerciseName, setLiveNewExerciseName] = useState('');
  const [liveNewExerciseMuscle, setLiveNewExerciseMuscle] = useState<MuscleGroup>('chest');
  const [customMuscleDraft, setCustomMuscleDraft] = useState('');
  const [activeSession, setActiveSession] = useState<LiveWorkout | null>(() => readLiveSession());
  const [metrics, setMetrics] = useState<BodyMetricsEntry[]>(() => readMetrics());
  const [metricDraft, setMetricDraft] = useState({ weight: '', bodyFat: '' });
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [syncMessage, setSyncMessage] = useState(
    isSupabaseConfigured
      ? 'Connecting to Supabase...'
      : 'Local mode only. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to sync with Supabase.'
  );
  const liveAddSectionRef = useRef<HTMLDivElement | null>(null);
  const appCardRef = useRef<HTMLElement | null>(null);
  const timerPrevRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    saveMuscles(muscles);
  }, [muscles]);

  useEffect(() => {
    if (activeSession) localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(activeSession));
    else localStorage.removeItem(LIVE_SESSION_KEY);
  }, [activeSession]);

  useEffect(() => {
    if (activeSession) setScreen('live');
  }, [activeSession]);

  useEffect(() => {
    if (screen === 'live') {
      window.setTimeout(() => {
        appCardRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }, 0);
    }
  }, [screen, activeSession?.id]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${BASE_URL}sw.js`).catch(() => undefined);
  }, []);

  useEffect(() => {
    saveMetrics(metrics);
  }, [metrics]);

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) return () => undefined;

    void (async () => {
      try {
        const snapshot = await loadRemoteSnapshot();
        if (cancelled) return;
        const templates = snapshot.templates.length ? snapshot.templates : defaultTemplates;
        setState({
          templates,
          sessions: snapshot.sessions,
          exerciseHistory: buildExerciseHistoryFromSessions(snapshot.sessions)
        });
        setMetrics(snapshot.metrics);
        setMuscles(snapshot.muscles);
        setSyncMessage('Supabase connected.');
        if (!snapshot.templates.length) {
          void Promise.all(defaultTemplates.map((template) => saveTemplateRecord(template))).catch((error) => {
            if (cancelled) return;
            setSyncMessage(`Could not seed starter workouts: ${getErrorMessage(error)}`);
          });
        }
      } catch (error) {
        if (cancelled) return;
        setSyncMessage(`Supabase sync failed: ${getErrorMessage(error)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const recentSessions = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return state.sessions.filter((session) => new Date(session.date).getTime() >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  }, [state.sessions]);

  const weeklyVolume = useMemo(
    () => recentSessions.reduce((total, session) => total + sessionVolume(session), 0),
    [recentSessions]
  );

  const muscleOptions = useMemo(() => {
    const inUse = [
      ...muscles,
      ...state.templates.flatMap((template) => template.exercises.map((exercise) => exercise.muscle)),
      ...state.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.muscle)),
      ...state.exerciseHistory.map((entry) => entry.muscle),
      ...(activeSession?.exercises.map((exercise) => exercise.muscle) ?? [])
    ];
    return sortMuscleNames(inUse);
  }, [activeSession, muscles, state.exerciseHistory, state.sessions, state.templates]);

  const muscleTotals = useMemo(() => {
    const totals: Record<MuscleGroup, number> = Object.fromEntries(muscleOptions.map((muscle) => [muscle, 0]));
    for (const session of recentSessions) {
      for (const exercise of session.exercises) {
        totals[exercise.muscle] = (totals[exercise.muscle] ?? 0) + exercise.sets.length;
      }
    }
    return totals;
  }, [muscleOptions, recentSessions]);

  const metricsPreview = useMemo(() => {
    const recent = metrics[0];
    const previous = metrics[1];
    return { recent, previous };
  }, [metrics]);

  const latestWorkoutVolume = useMemo(() => {
    const latestSession = state.sessions[0];
    return latestSession ? sessionVolume(latestSession) : null;
  }, [state.sessions]);

  const muscleProgression = useMemo(() => {
    return recentSessions.map((session) => {
      const muscleVolume = session.exercises.reduce((total, exercise) => {
        if (exercise.muscle !== selectedMuscle) return total;
        return (
          total +
          exercise.sets.reduce((setTotal, set) => {
            const weight = Number(set.weight);
            const reps = Number(set.reps);
            if (!Number.isFinite(weight) || !Number.isFinite(reps)) return setTotal;
            return setTotal + weight * reps;
          }, 0)
        );
      }, 0);

      return { date: session.date, volume: muscleVolume };
    });
  }, [recentSessions, selectedMuscle]);

  const selectedMuscleSummary = useMemo(() => {
    const [current, previous] = muscleProgression;
    return { current, previous };
  }, [muscleProgression]);

  const exerciseLibrary = useMemo(() => {
    const library = new Map<string, ExerciseHistoryEntry>();
    for (const entry of state.exerciseHistory) {
      if (!library.has(entry.key)) library.set(entry.key, entry);
    }
    for (const template of state.templates) {
      for (const exercise of template.exercises) {
        const key = historyKeyForExercise(exercise.name, exercise.muscle);
        if (!library.has(key)) {
          library.set(key, {
            key,
            name: exercise.name,
            muscle: exercise.muscle,
            date: '',
            sets: []
          });
        }
      }
    }
    return [...library.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.exerciseHistory, state.templates]);

  useEffect(() => {
    if (!muscleOptions.length) return;
    if (!muscleOptions.includes(selectedMuscle)) setSelectedMuscle(muscleOptions[0]);
  }, [muscleOptions, selectedMuscle]);

  const saveDraftExercise = (index: number, patch: Partial<Exercise>) => {
    setDraft((current) => {
      const exercises = current.exercises.slice();
      exercises[index] = { ...exercises[index], ...patch };
      return { ...current, exercises };
    });
  };

  const addExercise = () => {
    setDraft((current) => ({
      ...current,
      exercises: [...current.exercises, { id: uid(), name: '', muscle: muscleOptions[0] ?? 'chest' }]
    }));
  };

  const removeDraftExercise = (index: number) => {
    setDraft((current) => {
      if (current.exercises.length <= 1) return current;
      return { ...current, exercises: current.exercises.filter((_, exerciseIndex) => exerciseIndex !== index) };
    });
  };

  const addExistingExercise = () => {
    const selected = exerciseLibrary.find((entry) => entry.key === existingExerciseName);
    if (!selected) return;
    setDraft((current) => ({
      ...current,
      exercises: [...current.exercises, { id: uid(), name: selected.name, muscle: selected.muscle }]
    }));
    setExistingExerciseName('');
  };

  const addCustomMuscle = async () => {
    const normalized = normalizeMuscleName(customMuscleDraft);
    if (!normalized) return;
    if (muscleOptions.includes(normalized)) {
      setCustomMuscleDraft('');
      setSelectedMuscle(normalized);
      setLiveNewExerciseMuscle(normalized);
      return;
    }

    setMuscles((current) => sortMuscleNames([...current, normalized]));
    setCustomMuscleDraft('');
    setSelectedMuscle(normalized);
    setLiveNewExerciseMuscle(normalized);

    if (!isSupabaseConfigured) return;
    try {
      await saveMuscleRecord(normalized);
      setSyncMessage(`Saved custom muscle "${formatMuscleLabel(normalized)}" to Supabase.`);
    } catch (error) {
      setSyncMessage(`Could not save custom muscle: ${getErrorMessage(error)}`);
    }
  };

  const startCreateWorkout = () => {
    setDraft(blankWorkout());
    setEditingTemplateId(null);
    setExistingExerciseName('');
    setScreen('create');
  };

  const startEditWorkout = (template: WorkoutTemplate) => {
    setDraft(structuredClone(template));
    setEditingTemplateId(template.id);
    setExistingExerciseName('');
    setScreen('create');
  };

  const duplicateWorkout = (template: WorkoutTemplate) => {
    const clone = structuredClone(template);
    clone.id = uid();
    clone.name = clone.name.endsWith(' Copy') ? `${clone.name} 2` : `${clone.name} Copy`;
    clone.exercises = clone.exercises.map((exercise) => ({ ...exercise, id: uid() }));
    setDraft(clone);
    setEditingTemplateId(null);
    setExistingExerciseName('');
    setScreen('create');
  };

  const deleteWorkout = async (templateId: string) => {
    if (!window.confirm('Delete this workout template?')) return;
    setState((current) => ({ ...current, templates: current.templates.filter((template) => template.id !== templateId) }));
    if (!isSupabaseConfigured) return;
    try {
      await deleteTemplateRecord(templateId);
      setSyncMessage('Deleted workout template from Supabase.');
    } catch (error) {
      setSyncMessage(`Could not delete template in Supabase: ${getErrorMessage(error)}`);
    }
  };

  const addExerciseToLiveWorkout = (seed: ExerciseSeed) => {
    setActiveSession((current) => {
      if (!current) return current;
      return { ...current, exercises: [...current.exercises, createLiveExercise(seed, state.exerciseHistory)] };
    });
  };

  const addExistingExerciseToLive = () => {
    const selected = exerciseLibrary.find((entry) => entry.key === liveExistingExerciseName);
    if (!selected) return;
    addExerciseToLiveWorkout({ name: selected.name, muscle: selected.muscle });
    setLiveExistingExerciseName('');
  };

  const addNewExerciseToLive = () => {
    if (!liveNewExerciseName.trim()) return;
    addExerciseToLiveWorkout({ name: liveNewExerciseName.trim(), muscle: normalizeMuscleName(liveNewExerciseMuscle) });
    setLiveNewExerciseName('');
    setLiveNewExerciseMuscle(muscleOptions[0] ?? 'chest');
  };

  const moveExercise = (exerciseIndex: number, direction: -1 | 1) => {
    setActiveSession((current) => {
      if (!current) return current;
      const targetIndex = exerciseIndex + direction;
      if (targetIndex < 0 || targetIndex >= current.exercises.length) return current;
      const exercises = current.exercises.slice();
      [exercises[exerciseIndex], exercises[targetIndex]] = [exercises[targetIndex], exercises[exerciseIndex]];
      return { ...current, exercises };
    });
  };

  const scrollLiveTarget = (selector: string, offsetRatio = 0) => {
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(selector);
      const container = appCardRef.current;
      if (!target || !container) return;
      const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      const offset = container.clientHeight * offsetRatio;
      container.scrollTo({ top: Math.max(0, targetTop - offset), behavior: 'smooth' });
    }, 50);
  };

  const playRestAlarm = async () => {
    if (navigator.vibrate) navigator.vibrate(200);
    try {
      const AudioContextCtor =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      audioContextRef.current ??= new AudioContextCtor();
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      const currentTime = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.15, currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.25);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.26);
    } catch {
      // Ignore audio failures on browsers that block playback.
    }
  };

  const saveBodyMetrics = async () => {
    const weight = Number(metricDraft.weight);
    const bodyFat = Number(metricDraft.bodyFat);
    if (!Number.isFinite(weight) || !Number.isFinite(bodyFat)) return;
    const entry = { date: new Date().toISOString(), weight, bodyFat };
    setMetrics((current) => [entry, ...current].slice(0, 100));
    setMetricDraft({ weight: '', bodyFat: '' });

    if (!isSupabaseConfigured) return;
    try {
      await saveBodyMetricRecord(entry);
      setSyncMessage('Saved body metrics to Supabase.');
    } catch (error) {
      setSyncMessage(`Could not save body metrics: ${getErrorMessage(error)}`);
    }
  };

  const saveTemplate = async () => {
    if (!draft.name.trim() || !draft.exercises.some((exercise) => exercise.name.trim())) return;
    const cleanedTemplate: WorkoutTemplate = {
      ...structuredClone(draft),
      exercises: draft.exercises
        .filter((exercise) => exercise.name.trim())
        .map((exercise) => ({
          ...exercise,
          name: exercise.name.trim(),
          muscle: normalizeMuscleName(exercise.muscle)
        }))
    };

    setState((current) => {
      if (editingTemplateId) {
        return {
          ...current,
          templates: current.templates.map((template) => (template.id === editingTemplateId ? cleanedTemplate : template))
        };
      }
      return { ...current, templates: [cleanedTemplate, ...current.templates] };
    });
    setMuscles((current) => sortMuscleNames([...current, ...cleanedTemplate.exercises.map((exercise) => exercise.muscle)]));
    setDraft(blankWorkout());
    setEditingTemplateId(null);
    setExistingExerciseName('');
    setScreen('dashboard');

    if (!isSupabaseConfigured) return;
    try {
      await saveTemplateRecord(cleanedTemplate);
      setSyncMessage('Saved workout template to Supabase.');
    } catch (error) {
      setSyncMessage(`Could not save template: ${getErrorMessage(error)}`);
    }
  };

  const updateLive = (exerciseIndex: number, setIndex: number, patch: Partial<LiveSet>) => {
    setActiveSession((current) => {
      if (!current) return current;
      const exercises = current.exercises.map((exercise, exIndex) => {
        if (exIndex !== exerciseIndex) return exercise;
        return {
          ...exercise,
          sets: exercise.sets.map((set, sIndex) => (sIndex === setIndex ? { ...set, ...patch } : set))
        };
      });
      return { ...current, exercises };
    });
  };

  const completeSet = (exerciseIndex: number, setIndex: number) => {
    setActiveSession((current) => {
      if (!current) return current;
      const exercises = current.exercises.map((exercise, exIndex) => {
        if (exIndex !== exerciseIndex) return exercise;
        const sets = exercise.sets.map((set, sIndex) => (sIndex === setIndex ? { ...set, done: true } : set));
        if (setIndex + 1 < sets.length) {
          sets[setIndex + 1] = {
            ...sets[setIndex + 1],
            weight: sets[setIndex].weight,
            reps: sets[setIndex].reps
          };
        }
        return { ...exercise, sets };
      });
      return { ...current, exercises };
    });
    setRestUntil(Date.now() + 30000);
    const currentExercise = activeSession?.exercises[exerciseIndex];
    const nextSet = currentExercise?.sets[setIndex + 1];
    const nextExercise = activeSession?.exercises[exerciseIndex + 1];
    if (currentExercise && nextSet) scrollLiveTarget(`#live-set-${currentExercise.id}-${nextSet.id}`, 0.13);
    else if (nextExercise) scrollLiveTarget(`#live-exercise-${nextExercise.id}`, 0.2);
  };

  const adjustRest = (deltaSeconds: number) => {
    const base = restUntil && Date.now() < restUntil ? restUntil : Date.now();
    setRestUntil(Math.max(Date.now(), base + deltaSeconds * 1000));
  };

  const addSet = (exerciseIndex: number) => {
    setActiveSession((current) => {
      if (!current) return current;
      const exercises = current.exercises.map((exercise, exIndex) => {
        if (exIndex !== exerciseIndex) return exercise;
        const prev = exercise.sets[exercise.sets.length - 1];
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: uid(),
              weight: prev?.weight ?? '',
              reps: prev?.reps ?? '',
              done: false
            }
          ]
        };
      });
      return { ...current, exercises };
    });
    const currentExercise = activeSession?.exercises[exerciseIndex];
    if (currentExercise) scrollLiveTarget(`#live-exercise-${currentExercise.id}`, 0.15);
  };

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    setActiveSession((current) => {
      if (!current) return current;
      const exercises = current.exercises.map((exercise, exIndex) => {
        if (exIndex !== exerciseIndex || exercise.sets.length <= 1) return exercise;
        return { ...exercise, sets: exercise.sets.filter((_, sIndex) => sIndex !== setIndex) };
      });
      return { ...current, exercises };
    });
  };

  const finishWorkout = async () => {
    if (!activeSession) return;
    const finishedAt = new Date().toISOString();
    const finished: WorkoutSession = {
      id: activeSession.id,
      date: finishedAt,
      templateId: activeSession.templateId,
      templateName: activeSession.templateName,
      exercises: activeSession.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        muscle: exercise.muscle,
        sets: exercise.sets
          .filter((set) => set.weight !== '' || set.reps !== '')
          .map((set) => ({ weight: Number(set.weight), reps: Number(set.reps) }))
      }))
    };

    const historyUpdates = activeSession.exercises
      .filter((exercise) => exercise.sets.some((set) => set.weight !== '' || set.reps !== ''))
      .map((exercise) => ({
        key: historyKeyForExercise(exercise.name, exercise.muscle),
        name: exercise.name,
        muscle: normalizeMuscleName(exercise.muscle),
        date: finishedAt,
        sets: exercise.sets
          .filter((set) => set.weight !== '' || set.reps !== '')
          .map((set) => ({ weight: Number(set.weight), reps: Number(set.reps) }))
      }));

    setState((current) => {
      const dedupedHistory = [...historyUpdates, ...current.exerciseHistory].filter(
        (entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index
      );
      return { ...current, sessions: [finished, ...current.sessions].slice(0, 100), exerciseHistory: dedupedHistory.slice(0, 500) };
    });
    setActiveSession(null);
    setRestUntil(null);
    setScreen('dashboard');

    setMuscles((current) => sortMuscleNames([...current, ...finished.exercises.map((exercise) => exercise.muscle)]));

    if (!isSupabaseConfigured) return;
    try {
      await saveWorkoutSessionRecord(finished);
      setSyncMessage('Saved finished workout to Supabase.');
    } catch (error) {
      setSyncMessage(`Could not save finished workout: ${getErrorMessage(error)}`);
    }
  };

  const cancelWorkout = () => {
    if (!activeSession) return;
    if (!window.confirm('Cancel this workout and discard all progress?')) return;
    setActiveSession(null);
    setRestUntil(null);
    setLiveExistingExerciseName('');
    setLiveNewExerciseName('');
    setLiveNewExerciseMuscle(muscleOptions[0] ?? 'chest');
    setScreen('dashboard');
    setSyncMessage('Workout cancelled.');
  };

  const timerLeft = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (timerPrevRef.current > 0 && restUntil && timerLeft === 0) {
      void playRestAlarm();
    }
    timerPrevRef.current = timerLeft;
  }, [restUntil, timerLeft]);

  return (
    <div className="app-shell">
      <main className="app-card" ref={appCardRef}>
        {screen !== 'live' && (
          <header className="topbar">
            <div className="topbar-copy">
              <h1>Lift Log</h1>
              <p className="muted status-note">
                <span className="status-badge" aria-hidden="true">✓</span>
                <span>{syncMessage}</span>
              </p>
            </div>
            <button className="ghost-btn topbar-stats-btn" onClick={() => setScreen('stats')}>
              <span aria-hidden="true">◫</span>
              <span>Stats</span>
            </button>
          </header>
        )}

        {screen === 'dashboard' && (
          <section className="stack dashboard-stack">
            <div className="panel stack dashboard-panel weekly-panel">
              <div className="section-title section-title-with-icon">
                <span className="section-icon" aria-hidden="true">◷</span>
                <span>This Week</span>
              </div>
              <div className="stat-row">
                <span>Volume</span>
                <strong>{weeklyVolume.toLocaleString()} lbs</strong>
              </div>
              <div className="stat-row">
                <span>Last Workout</span>
                <strong>
                  {latestWorkoutVolume !== null ? `${latestWorkoutVolume.toLocaleString()} lbs` : 'No workouts yet'}
                </strong>
              </div>
            </div>
            <div className="panel stack dashboard-panel body-metrics-panel">
              <div className="section-title section-title-with-icon">
                <span className="section-icon" aria-hidden="true">◌</span>
                <span>Body Metrics</span>
              </div>
              <div className="exercise-row">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Weight (lbs)"
                  value={metricDraft.weight}
                  onChange={(e) => setMetricDraft((current) => ({ ...current, weight: e.target.value }))}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Body fat (%)"
                  value={metricDraft.bodyFat}
                  onChange={(e) => setMetricDraft((current) => ({ ...current, bodyFat: e.target.value }))}
                />
              </div>
              <button className="primary-btn metrics-save-btn" onClick={saveBodyMetrics}>
                <span aria-hidden="true">⌁</span>
                <span>Save metrics</span>
              </button>
              <div className="stack metric-summary-list">
                <div className="stat-row metric-summary-row">
                  <span>Weight</span>
                  <strong>
                    {metricsPreview.recent && metricsPreview.previous
                      ? `${metricsPreview.previous.weight} → ${metricsPreview.recent.weight} lbs`
                      : metricsPreview.recent
                        ? `${metricsPreview.recent.weight} lbs`
                        : 'No entries yet'}
                  </strong>
                </div>
                <div className="stat-row metric-summary-row">
                  <span>Body Fat</span>
                  <strong>
                    {metricsPreview.recent && metricsPreview.previous
                      ? `${metricsPreview.previous.bodyFat}% → ${metricsPreview.recent.bodyFat}%`
                      : metricsPreview.recent
                        ? `${metricsPreview.recent.bodyFat}%`
                        : 'No entries yet'}
                  </strong>
                </div>
              </div>
            </div>
            <div className="panel dashboard-panel templates-panel">
              <div className="section-title section-title-with-icon">
                <span className="section-icon" aria-hidden="true">⌘</span>
                <span>Workout Templates</span>
              </div>
              <div className="list">
                {state.templates.map((template) => (
                  <div key={template.id} className="list-item template-item template-card">
                    <div className="template-card-summary">
                      <button
                        className="template-card-main"
                        onClick={() => {
                          setActiveSession(createWorkoutSession(template, state.exerciseHistory));
                          setScreen('live');
                        }}
                      >
                        <span className="template-card-icon" aria-hidden="true">▣</span>
                        <span className="template-card-copy">
                          <strong>{template.name}</strong>
                          <span>{template.exercises.length} exercises</span>
                        </span>
                      </button>
                    </div>
                    <div className="template-card-actions">
                      <button className="ghost-btn" onClick={() => startEditWorkout(template)}>Edit</button>
                      <button className="ghost-btn" onClick={() => duplicateWorkout(template)}>Duplicate</button>
                      <button className="ghost-btn danger-btn" onClick={() => deleteWorkout(template.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {screen === 'create' && (
          <section className="stack">
            <label className="field">
              <span>{editingTemplateId ? 'Edit workout name' : 'Workout name'}</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                placeholder="Push A"
              />
            </label>

            <div className="panel stack">
              <div className="section-title">Exercises</div>
              <div className="existing-exercise-picker">
                <select
                  value={existingExerciseName}
                  onChange={(e) => setExistingExerciseName(e.target.value)}
                >
                  <option value="">Add existing exercise</option>
                  {exerciseLibrary.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name} ({formatMuscleLabel(entry.muscle)})
                    </option>
                  ))}
                </select>
                <button className="secondary-btn" onClick={addExistingExercise} disabled={!existingExerciseName}>
                  Add
                </button>
              </div>
              {draft.exercises.map((exercise, index) => (
                <div className="exercise-row" key={exercise.id}>
                  <input
                    value={exercise.name}
                    onChange={(e) => saveDraftExercise(index, { name: e.target.value })}
                    placeholder="Bench Press"
                  />
                  <select
                    value={exercise.muscle}
                    onChange={(e) => saveDraftExercise(index, { muscle: e.target.value as MuscleGroup })}
                  >
                    {muscleOptions.map((muscle) => (
                      <option key={muscle} value={muscle}>{formatMuscleLabel(muscle)}</option>
                    ))}
                  </select>
                  <button
                    className="ghost-btn"
                    onClick={() => removeDraftExercise(index)}
                    disabled={draft.exercises.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button className="secondary-btn" onClick={addExercise}>+ Add exercise</button>
            </div>

            <div className="actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  setEditingTemplateId(null);
                  setExistingExerciseName('');
                  setScreen('dashboard');
                }}
              >
                Cancel
              </button>
              <button className="primary-btn" onClick={saveTemplate}>
                {editingTemplateId ? 'Update workout' : 'Save workout'}
              </button>
            </div>
          </section>
        )}

        {screen === 'live' && activeSession && (
          <section className="stack">
            <div className="sticky-workout-bar">
              <div className="timer-wrap">
                {restUntil && Date.now() < restUntil ? (
                  <div className="timer">{`Rest ${timerLeft}s`}</div>
                ) : (
                  <div className="timer">Rest timer ready</div>
                )}
                <div className="timer-controls">
                  <button className="ghost-btn" onClick={() => adjustRest(-30)}>-30s</button>
                  <button className="ghost-btn" onClick={() => setRestUntil(Date.now() + 30000)}>30s</button>
                  <button className="ghost-btn" onClick={() => adjustRest(30)}>+30s</button>
                </div>
              </div>
            </div>

            {activeSession.exercises.map((exercise, exerciseIndex) => (
              <article className="exercise-card" key={exercise.id} id={`live-exercise-${exercise.id}`}>
                <div className="exercise-head">
                  <div>
                    <h2>{exercise.name}</h2>
                    <p>{formatMuscleLabel(exercise.muscle)}</p>
                    <p className="last-session">
                      {getPreviousExerciseSummary(exercise.name, exercise.muscle, state.exerciseHistory) || 'No previous session'}
                    </p>
                  </div>
                  <div className="exercise-head-actions">
                    <button className="ghost-btn" onClick={() => moveExercise(exerciseIndex, -1)} disabled={exerciseIndex === 0}>
                      ↑
                    </button>
                    <button className="ghost-btn" onClick={() => moveExercise(exerciseIndex, 1)} disabled={exerciseIndex === activeSession.exercises.length - 1}>
                      ↓
                    </button>
                    <button className="ghost-btn" onClick={() => addSet(exerciseIndex)}>+ Set</button>
                  </div>
                </div>

                <div className="sets">
                  {exercise.sets.map((set, setIndex) => (
                    <div className={`set-row ${set.done ? 'done' : ''}`} key={set.id} id={`live-set-${exercise.id}-${set.id}`}>
                      <div className="set-number">Set {setIndex + 1}</div>
                      <div className="set-row-fields">
                        <div className="set-field">
                          <label>Weight</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={set.weight}
                            placeholder="185"
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => updateLive(exerciseIndex, setIndex, { weight: e.target.value })}
                          />
                        </div>
                        <div className="set-field">
                          <label>Reps</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={set.reps}
                            placeholder="8"
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => updateLive(exerciseIndex, setIndex, { reps: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="set-row-actions">
                        <button
                          className={set.done ? 'primary-btn set-complete-btn set-complete-btn-done' : 'primary-btn set-complete-btn'}
                          onClick={() => completeSet(exerciseIndex, setIndex)}
                        >
                          {set.done ? 'Done' : 'Complete'}
                        </button>
                        <button className="ghost-btn" onClick={() => removeSet(exerciseIndex, setIndex)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
            </article>
            ))}

            <div ref={liveAddSectionRef} className="panel stack live-add-panel">
              <div className="section-title">Add exercise</div>
              <div className="existing-exercise-picker">
                <select
                  value={liveExistingExerciseName}
                  onChange={(e) => setLiveExistingExerciseName(e.target.value)}
                >
                  <option value="">Add existing exercise</option>
                  {exerciseLibrary.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name} ({formatMuscleLabel(entry.muscle)})
                    </option>
                  ))}
                </select>
                <button className="secondary-btn" onClick={addExistingExerciseToLive} disabled={!liveExistingExerciseName}>
                  Add
                </button>
              </div>
              <div className="exercise-row live-new-exercise-row">
                <input
                  value={liveNewExerciseName}
                  onChange={(e) => setLiveNewExerciseName(e.target.value)}
                  placeholder="New exercise"
                />
                <select
                  value={liveNewExerciseMuscle}
                  onChange={(e) => setLiveNewExerciseMuscle(e.target.value as MuscleGroup)}
                >
                  {muscleOptions.map((muscle) => (
                    <option key={muscle} value={muscle}>{formatMuscleLabel(muscle)}</option>
                  ))}
                </select>
                <button className="secondary-btn" onClick={addNewExerciseToLive} disabled={!liveNewExerciseName.trim()}>
                  Add
                </button>
              </div>
            </div>

            <div className="live-workout-actions">
              <button className="secondary-btn big danger-btn" onClick={cancelWorkout}>
                Cancel Workout
              </button>
              <button className="primary-btn big" onClick={finishWorkout}>Finish Workout</button>
            </div>
          </section>
        )}

        {screen === 'stats' && (
          <section className="stack">
            <div className="panel stats-compact-panel">
              <div className="section-title">Last 7 days</div>
              <div className="stats-list">
                {muscleOptions.map((muscle) => {
                  const muscleKey = muscle as MuscleGroup;
                  const count = muscleTotals[muscleKey] ?? 0;
                  const bar = '█'.repeat(Math.max(1, Math.min(12, Math.round(count / 2))));
                  return (
                    <div key={muscleKey} className="stat-row">
                      <span>{formatMuscleLabel(muscleKey)}</span>
                      <strong>{bar} ({count})</strong>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel stack stats-compact-panel">
              <div className="section-title">Progressive Overload</div>
              <div className="muscle-tabs muscle-tabs-vertical">
                {muscleOptions.map((muscle) => {
                  const key = muscle as MuscleGroup;
                  return (
                    <button
                      key={key}
                      className={selectedMuscle === key ? 'muscle-tab muscle-tab-active' : 'muscle-tab'}
                      onClick={() => setSelectedMuscle(key)}
                    >
                      {formatMuscleLabel(key)}
                    </button>
                  );
                })}
              </div>
              <div className="stat-row">
                <span>{formatMuscleLabel(selectedMuscle)} this week</span>
                <strong>
                  {muscleProgression.reduce((total, entry) => total + entry.volume, 0).toLocaleString()} lbs
                </strong>
              </div>
              <div className="stat-row">
                <span>Most recent</span>
                <strong>
                  {selectedMuscleSummary.current
                    ? `${selectedMuscleSummary.current.volume.toLocaleString()} lbs on ${formatDate(selectedMuscleSummary.current.date)}`
                    : 'No recent sets'}
                </strong>
              </div>
              <div className="stat-row">
                <span>Previous</span>
                <strong>
                  {selectedMuscleSummary.previous
                    ? `${selectedMuscleSummary.previous.volume.toLocaleString()} lbs on ${formatDate(selectedMuscleSummary.previous.date)}`
                    : 'No previous session'}
                </strong>
              </div>
              {selectedMuscleSummary.current && selectedMuscleSummary.previous && (
                <div className="muted">
                  Change: {selectedMuscleSummary.previous.volume.toLocaleString()} → {selectedMuscleSummary.current.volume.toLocaleString()} lbs
                </div>
              )}
            </div>

            <div className="panel stats-compact-panel">
              <div className="section-title">Recent workouts</div>
              <div className="list">
                {recentSessions.map((session) => (
                  <div key={session.id} className="list-item static recent-workout-item">
                    <strong>{session.templateName}</strong>
                    <span>
                      {formatDate(session.date)} · {sessionVolume(session).toLocaleString()} lbs
                    </span>
                  </div>
                ))}
                {!recentSessions.length && <p className="muted">No workouts logged in the last 7 days.</p>}
              </div>
            </div>
            <div className="panel stack stats-compact-panel">
              <div className="section-title">Body Metrics History</div>
              {metrics.length ? (
                metrics.slice(0, 5).map((entry, index) => {
                  const next = metrics[index + 1];
                  return (
                    <div key={`${entry.date}-${index}`} className="metric-history-row">
                      <div className="metric-history-date">{formatDate(entry.date)}</div>
                      <div className="metric-history-values">
                        <span>Weight: {entry.weight} lbs</span>
                        <span>Body Fat: {entry.bodyFat}%</span>
                      </div>
                      {next && (
                        <div className="metric-history-delta">
                          Compared to {formatDate(next.date)}: {next.weight} → {entry.weight} lbs, {next.bodyFat}% → {entry.bodyFat}%
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="muted">No body metrics recorded yet.</p>
              )}
            </div>
            <div className="panel stack stats-compact-panel">
              <div className="section-title">Muscle Groups</div>
              <div className="exercise-row">
                <input
                  value={customMuscleDraft}
                  onChange={(e) => setCustomMuscleDraft(e.target.value)}
                  placeholder="Add custom muscle"
                />
                <button className="secondary-btn" onClick={addCustomMuscle} disabled={!customMuscleDraft.trim()}>
                  Save muscle
                </button>
              </div>
              <div className="stats-list">
                {muscleOptions.map((muscle) => (
                  <div key={muscle} className="stat-row">
                    <span>{formatMuscleLabel(muscle)}</span>
                    <strong>{DEFAULT_MUSCLES.includes(muscle as (typeof DEFAULT_MUSCLES)[number]) ? 'Built-in' : 'Custom'}</strong>
                  </div>
                ))}
              </div>
            </div>

            <button className="secondary-btn" onClick={() => setScreen('dashboard')}>Back</button>
          </section>
        )}

        <nav className="bottom-nav">
          <button className={screen === 'dashboard' ? 'nav-active' : ''} onClick={() => setScreen('dashboard')}>Dashboard</button>
          <button className={screen === 'create' ? 'nav-active' : ''} onClick={() => setScreen('create')}>Create</button>
          <button className={screen === 'live' ? 'nav-active' : ''} onClick={() => activeSession && setScreen('live')}>Live</button>
        </nav>
      </main>
    </div>
  );
}
