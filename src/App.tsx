import { useEffect, useMemo, useState } from 'react';

type MuscleGroup = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms';
type Exercise = { id: string; name: string; muscle: MuscleGroup };
type WorkoutTemplate = { id: string; name: string; exercises: Exercise[] };
type LiveSet = { id: string; weight: string; reps: string; done: boolean };
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

const STORAGE_KEY = 'lift-log-mvp';
const LIVE_SESSION_KEY = 'lift-log-live-session';
const BASE_URL = import.meta.env.BASE_URL;
const MUSCLES: MuscleGroup[] = ['chest', 'back', 'legs', 'shoulders', 'arms'];
const DEFAULT_SET_COUNT = 3;

const uid = () => crypto.randomUUID();

const defaultTemplates: WorkoutTemplate[] = [
  {
    id: uid(),
    name: 'Push',
    exercises: [
      { id: uid(), name: 'Bench Press', muscle: 'chest' },
      { id: uid(), name: 'Shoulder Press', muscle: 'shoulders' },
      { id: uid(), name: 'Triceps Pushdown', muscle: 'arms' }
    ]
  },
  {
    id: uid(),
    name: 'Pull',
    exercises: [
      { id: uid(), name: 'Barbell Row', muscle: 'back' },
      { id: uid(), name: 'Lat Pulldown', muscle: 'back' },
      { id: uid(), name: 'Bicep Curl', muscle: 'arms' }
    ]
  }
];

const blankWorkout = (): WorkoutTemplate => ({
  id: uid(),
  name: '',
  exercises: [{ id: uid(), name: '', muscle: 'chest' }]
});

function readState(): { templates: WorkoutTemplate[]; sessions: WorkoutSession[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { templates: defaultTemplates, sessions: [] };
    const parsed = JSON.parse(raw);
    return {
      templates: Array.isArray(parsed.templates) && parsed.templates.length ? parsed.templates : defaultTemplates,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  } catch {
    return { templates: defaultTemplates, sessions: [] };
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
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function lastSessionForExercise(exerciseName: string, sessions: WorkoutSession[]) {
  const found = [...sessions].reverse().find((session) => session.exercises.some((ex) => ex.name === exerciseName));
  const exercise = found?.exercises.find((ex) => ex.name === exerciseName);
  const lastSet = exercise && exercise.sets.length ? exercise.sets[exercise.sets.length - 1] : null;
  return lastSet ? `${lastSet.weight} x ${lastSet.reps}` : '';
}

function createWorkoutSession(template: WorkoutTemplate, sessions: WorkoutSession[]): LiveWorkout {
  return {
    id: uid(),
    templateId: template.id,
    templateName: template.name,
    exercises: template.exercises.map((exercise) => {
      const last = [...sessions].reverse().find((session) => session.exercises.some((x) => x.name === exercise.name));
      const lastEx = last?.exercises.find((x) => x.name === exercise.name);
      const prev = lastEx && lastEx.sets.length ? lastEx.sets[lastEx.sets.length - 1] : null;
      return {
        id: exercise.id,
        name: exercise.name,
        muscle: exercise.muscle,
        sets: Array.from({ length: DEFAULT_SET_COUNT }, () => ({
          id: uid(),
          weight: String(prev?.weight ?? ''),
          reps: String(prev?.reps ?? ''),
          done: false
        }))
      };
    })
  };
}

export default function App() {
  const [state, setState] = useState(readState);
  const [screen, setScreen] = useState<'dashboard' | 'create' | 'live' | 'stats'>('dashboard');
  const [draft, setDraft] = useState<WorkoutTemplate>(blankWorkout);
  const [activeSession, setActiveSession] = useState<LiveWorkout | null>(() => readLiveSession());
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (activeSession) localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(activeSession));
    else localStorage.removeItem(LIVE_SESSION_KEY);
  }, [activeSession]);

  useEffect(() => {
    if (activeSession) setScreen('live');
  }, [activeSession]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${BASE_URL}sw.js`).catch(() => undefined);
  }, []);

  const recentSessions = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return state.sessions.filter((session) => new Date(session.date).getTime() >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  }, [state.sessions]);

  const muscleTotals = useMemo(() => {
    const totals: Record<MuscleGroup, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0 };
    for (const session of recentSessions) {
      for (const exercise of session.exercises) totals[exercise.muscle] += exercise.sets.length;
    }
    return totals;
  }, [recentSessions]);

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
      exercises: [...current.exercises, { id: uid(), name: '', muscle: 'chest' }]
    }));
  };

  const saveTemplate = () => {
    if (!draft.name.trim() || !draft.exercises.some((exercise) => exercise.name.trim())) return;
    setState((current) => ({ ...current, templates: [structuredClone(draft), ...current.templates] }));
    setDraft(blankWorkout());
    setScreen('dashboard');
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

  const finishWorkout = () => {
    if (!activeSession) return;
    const finished: WorkoutSession = {
      id: activeSession.id,
      date: new Date().toISOString(),
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

    setState((current) => ({ ...current, sessions: [finished, ...current.sessions].slice(0, 100) }));
    setActiveSession(null);
    setRestUntil(null);
    setScreen('dashboard');
  };

  const timerLeft = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;

  return (
    <div className="app-shell">
      <main className="app-card">
        {screen !== 'live' && (
          <header className="topbar">
            <div>
              <p className="eyebrow">Lift Log</p>
              <h1>Fast weightlifting tracker</h1>
            </div>
            <button className="ghost-btn" onClick={() => setScreen('stats')}>Stats</button>
          </header>
        )}

        {screen === 'dashboard' && (
          <section className="stack">
            <button className="primary-btn big" onClick={() => { setDraft(blankWorkout()); setScreen('create'); }}>
              Start Workout
            </button>
            <div className="panel">
              <div className="section-title">Workout templates</div>
              <div className="list">
                {state.templates.map((template) => (
                  <button
                    key={template.id}
                    className="list-item"
                    onClick={() => {
                      setActiveSession(createWorkoutSession(template, state.sessions));
                      setScreen('live');
                    }}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.exercises.length} exercises</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {screen === 'create' && (
          <section className="stack">
            <label className="field">
              <span>Workout name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                placeholder="Push A"
              />
            </label>

            <div className="panel stack">
              <div className="section-title">Exercises</div>
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
                    {MUSCLES.map((muscle) => (
                      <option key={muscle} value={muscle}>{muscle}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button className="secondary-btn" onClick={addExercise}>+ Add exercise</button>
            </div>

            <div className="actions">
              <button className="secondary-btn" onClick={() => setScreen('dashboard')}>Cancel</button>
              <button className="primary-btn" onClick={saveTemplate}>Save workout</button>
            </div>
          </section>
        )}

        {screen === 'live' && activeSession && (
          <section className="stack">
            <div className="sticky-workout-bar">
              <div className="sticky-workout-title">
                <div className="section-title">{activeSession.templateName}</div>
                <div className="sticky-workout-status">Sticky rest timer</div>
              </div>
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
              <article className="exercise-card" key={exercise.id}>
                <div className="exercise-head">
                  <div>
                    <h2>{exercise.name}</h2>
                    <p>{exercise.muscle}</p>
                    <p className="last-session">{lastSessionForExercise(exercise.name, state.sessions) || 'No previous session'}</p>
                  </div>
                  <button className="ghost-btn" onClick={() => addSet(exerciseIndex)}>+ Set</button>
                </div>

                <div className="sets">
                  {exercise.sets.map((set, setIndex) => (
                    <div className={`set-row ${set.done ? 'done' : ''}`} key={set.id}>
                      <div className="set-row-fields">
                        <div className="set-field">
                          <label>Weight</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={set.weight}
                            placeholder="185"
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
                            onChange={(e) => updateLive(exerciseIndex, setIndex, { reps: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="set-row-actions">
                        <button className="primary-btn" onClick={() => completeSet(exerciseIndex, setIndex)}>
                          {set.done ? 'Done' : 'Complete'}
                        </button>
                        <button className="ghost-btn" onClick={() => removeSet(exerciseIndex, setIndex)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
            </article>
            ))}

            <button className="primary-btn big" onClick={finishWorkout}>Finish Workout</button>
          </section>
        )}

        {screen === 'stats' && (
          <section className="stack">
            <div className="panel">
              <div className="section-title">Last 7 days</div>
              <div className="stats-list">
                {MUSCLES.map((muscle) => {
                  const count = muscleTotals[muscle];
                  const bar = '█'.repeat(Math.max(1, Math.min(12, Math.round(count / 2))));
                  return (
                    <div key={muscle} className="stat-row">
                      <span>{muscle}</span>
                      <strong>{bar} ({count})</strong>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel">
              <div className="section-title">Recent workouts</div>
              <div className="list">
                {recentSessions.map((session) => (
                  <div key={session.id} className="list-item static">
                    <strong>{session.templateName}</strong>
                    <span>{formatDate(session.date)}</span>
                  </div>
                ))}
                {!recentSessions.length && <p className="muted">No workouts logged in the last 7 days.</p>}
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
