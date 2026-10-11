// Persists everything in localStorage. Wrapped in try/catch because storage can be
// unavailable (private browsing, blocked site data) — the app still works, it just won't remember.

const KEY = 'underdog-edge-v1';

// Underdog's payouts change over time and vary by state; users can edit these in Settings.
export const DEFAULT_PAYOUTS = {
  standard: { 2: 3, 3: 6, 4: 10, 5: 20, 6: 35 },
  flex: {
    3: { 3: 3, 2: 1 },
    4: { 4: 6, 3: 1.5 },
    5: { 5: 10, 4: 2.5 },
    6: { 6: 25, 5: 2.6, 4: 0.25 },
  },
};

export const DEFAULT_SETTINGS = {
  bankroll: 200,
  defaultStake: 5,
  kellyFraction: 0.25,
  maxStakePct: 5,
  weights: { market: 0.6, model: 0.25, history: 0.15 },
  shrink: 0.1,
  rho: 0,
  payouts: DEFAULT_PAYOUTS,
  apiKey: '',
  regions: 'us,us_dfs',
  sharpBooks: ['pinnacle', 'fanduel', 'draftkings'],
};

function fresh() {
  return {
    picks: [],
    entry: { type: 'standard', stake: null },
    settings: structuredClone(DEFAULT_SETTINGS),
    log: [],
  };
}

export function loadState() {
  const base = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return base;
    return {
      picks: Array.isArray(saved.picks) ? saved.picks : [],
      entry: { ...base.entry, ...saved.entry },
      settings: {
        ...base.settings,
        ...saved.settings,
        weights: { ...base.settings.weights, ...saved.settings?.weights },
        payouts: saved.settings?.payouts ?? base.settings.payouts,
      },
      log: Array.isArray(saved.log) ? saved.log : [],
    };
  } catch {
    return base;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}
