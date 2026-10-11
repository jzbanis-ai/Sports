// Pure probability / betting math. No DOM access, so it can be unit-tested in Node.

// ---------- Odds conversions ----------

export function americanToProb(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0 || (o > -100 && o < 100)) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

export function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

// Remove the bookmaker's margin from a two-way market (multiplicative method).
// Returns the fair probability of the Over side.
export function devig(overOdds, underOdds) {
  const po = americanToProb(overOdds);
  const pu = americanToProb(underOdds);
  if (po == null || pu == null) return null;
  return po / (po + pu);
}

// ---------- Distributions ----------

// Abramowitz & Stegun 7.1.26, max error ~1.5e-7.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x, mu = 0, sd = 1) {
  return 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2)));
}

export function poissonPmf(k, lambda) {
  if (k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  let sum = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

// ---------- Stat catalog ----------
// dist: 'normal' (cv = sd/mean, minSd floor, sqrtK = floor of k*sqrt(mean)) or 'poisson'.
// discrete: integer-valued stat, so continuity correction and pushes apply.

const FOOTBALL_STATS = {
  pass_yds: { label: 'Passing Yards', dist: 'normal', cv: 0.27, minSd: 35, discrete: true },
  pass_tds: { label: 'Passing TDs', dist: 'poisson', discrete: true },
  pass_att: { label: 'Pass Attempts', dist: 'normal', cv: 0.16, minSd: 4, discrete: true },
  pass_comp: { label: 'Completions', dist: 'normal', cv: 0.19, minSd: 3.5, discrete: true },
  pass_int: { label: 'Interceptions', dist: 'poisson', discrete: true },
  rush_yds: { label: 'Rushing Yards', dist: 'normal', cv: 0.5, minSd: 12, discrete: true },
  rush_att: { label: 'Rush Attempts', dist: 'normal', cv: 0.3, minSd: 3, discrete: true },
  receptions: { label: 'Receptions', dist: 'normal', cv: 0.38, sqrtK: 1.05, minSd: 1.2, discrete: true },
  rec_yds: { label: 'Receiving Yards', dist: 'normal', cv: 0.6, minSd: 12, discrete: true },
  rush_rec_yds: { label: 'Rush + Rec Yards', dist: 'normal', cv: 0.45, minSd: 15, discrete: true },
  pass_rush_yds: { label: 'Pass + Rush Yards', dist: 'normal', cv: 0.26, minSd: 35, discrete: true },
  rush_rec_tds: { label: 'Rush + Rec TDs', dist: 'poisson', discrete: true },
  fantasy_pts: { label: 'Fantasy Points', dist: 'normal', cv: 0.45, minSd: 4, discrete: false },
};

const BASKETBALL_STATS = {
  points: { label: 'Points', dist: 'normal', cv: 0.28, minSd: 3, discrete: true },
  rebounds: { label: 'Rebounds', dist: 'normal', cv: 0.33, sqrtK: 1.1, minSd: 1.5, discrete: true },
  assists: { label: 'Assists', dist: 'normal', cv: 0.36, sqrtK: 1.1, minSd: 1.5, discrete: true },
  threes: { label: '3-Pointers Made', dist: 'poisson', discrete: true },
  pra: { label: 'Pts + Reb + Ast', dist: 'normal', cv: 0.22, minSd: 4, discrete: true },
  pts_reb: { label: 'Pts + Reb', dist: 'normal', cv: 0.25, minSd: 3.5, discrete: true },
  pts_ast: { label: 'Pts + Ast', dist: 'normal', cv: 0.25, minSd: 3.5, discrete: true },
  reb_ast: { label: 'Reb + Ast', dist: 'normal', cv: 0.3, sqrtK: 1.1, minSd: 2, discrete: true },
  steals: { label: 'Steals', dist: 'poisson', discrete: true },
  blocks: { label: 'Blocks', dist: 'poisson', discrete: true },
  blk_stl: { label: 'Blocks + Steals', dist: 'poisson', discrete: true },
  turnovers: { label: 'Turnovers', dist: 'poisson', discrete: true },
  fantasy_pts: { label: 'Fantasy Points', dist: 'normal', cv: 0.25, minSd: 5, discrete: false },
};

export const SPORTS = {
  NFL: { label: 'NFL', stats: FOOTBALL_STATS, varianceScale: 1.0 },
  CFB: { label: 'College Football', stats: FOOTBALL_STATS, varianceScale: 1.15 },
  NBA: { label: 'NBA', stats: BASKETBALL_STATS, varianceScale: 1.0 },
};

export function statInfo(sport, stat) {
  return SPORTS[sport]?.stats[stat] ?? null;
}

export function statSd(sport, stat, mu) {
  const info = statInfo(sport, stat);
  if (!info || info.dist !== 'normal') return null;
  const scale = SPORTS[sport].varianceScale;
  const m = Math.max(mu, 0.01);
  return Math.max(info.cv * m * scale, (info.sqrtK ?? 0) * Math.sqrt(m) * scale, info.minSd * scale);
}

// Probability that a stat lands over / under / exactly on the line, given its expected value.
export function outcomeProbs(sport, stat, mu, line) {
  const info = statInfo(sport, stat);
  if (!info || !(mu >= 0) || !Number.isFinite(line)) return null;
  const isInt = Number.isInteger(line);

  if (info.dist === 'poisson') {
    const lambda = Math.max(mu, 1e-6);
    const under = poissonCdf(Math.ceil(line) - 1, lambda);
    const push = isInt ? poissonPmf(line, lambda) : 0;
    return { over: Math.max(0, 1 - under - push), under, push };
  }

  const sd = statSd(sport, stat, mu);
  if (!info.discrete) {
    const under = normalCdf(line, mu, sd);
    return { over: 1 - under, under, push: 0 };
  }
  // Continuity correction: stat is an integer, so "over 24.5" means X >= 25.
  const under = normalCdf(Math.ceil(line) - 0.5, mu, sd);
  const overStart = Math.floor(line) + 0.5;
  const over = 1 - normalCdf(overStart, mu, sd);
  const push = isInt ? Math.max(0, 1 - over - under) : 0;
  return { over, under, push };
}

// P(over | not a push). Pushes void the pick on Underdog, so this is the win rate that matters.
export function overProbNoPush(sport, stat, mu, line) {
  const o = outcomeProbs(sport, stat, mu, line);
  if (!o) return null;
  const denom = o.over + o.under;
  return denom > 0 ? o.over / denom : null;
}

// Back out the expected value (mean) the market is pricing, from a line and fair Over probability.
export function impliedMean(sport, stat, line, pOver) {
  if (!statInfo(sport, stat) || !(pOver > 0 && pOver < 1)) return null;
  let lo = 0.001;
  let hi = Math.max(line * 4, line + 30, 5);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (overProbNoPush(sport, stat, mid, line) < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Empirical hit rate from recent game logs, shrunk toward 50% (Beta(2,2) prior)
// because 5-10 game samples are noisy.
export function historyOverProb(values, line, priorWeight = 4) {
  const vals = values.filter((v) => Number.isFinite(v));
  let over = 0;
  let n = 0;
  for (const v of vals) {
    if (v === line) continue;
    n++;
    if (v > line) over++;
  }
  if (n === 0) return null;
  return { p: (over + priorWeight / 2) / (n + priorWeight), hits: over, n };
}

export function mean(values) {
  const vals = values.filter((v) => Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ---------- Combining sources into one estimate for a pick ----------

/**
 * pick: { sport, stat, line, overOdds, underOdds, marketMean, projection, logs }
 *   marketMean: implied mean from sharp books (e.g. from Odds API), already consensus
 * weights: { market, model, history }
 * shrink: pull final estimate this fraction of the way back toward 50%
 * Returns { pOver, sources: [{name, pOver}] } or null if nothing to go on.
 */
export function estimatePick(pick, weights, shrink = 0) {
  const { sport, stat, line } = pick;
  const sources = [];

  let marketP = null;
  if (Number.isFinite(pick.marketMean)) {
    marketP = overProbNoPush(sport, stat, pick.marketMean, line);
  } else if (pick.overOdds != null && pick.underOdds != null) {
    // Odds entered by hand are assumed to be quoted at the same line as Underdog.
    marketP = devig(pick.overOdds, pick.underOdds);
  }
  if (marketP != null) sources.push({ name: 'market', pOver: marketP, w: weights.market });

  if (Number.isFinite(pick.projection)) {
    const p = overProbNoPush(sport, stat, pick.projection, line);
    if (p != null) sources.push({ name: 'model', pOver: p, w: weights.model });
  }

  if (pick.logs?.length) {
    const h = historyOverProb(pick.logs, line);
    if (h) sources.push({ name: 'history', pOver: h.p, w: weights.history, hits: h.hits, n: h.n });
  }

  const totalW = sources.reduce((a, s) => a + s.w, 0);
  if (!sources.length || totalW <= 0) return null;
  const raw = sources.reduce((a, s) => a + s.pOver * s.w, 0) / totalW;
  const pOver = 0.5 + (raw - 0.5) * (1 - shrink);
  return { pOver, sources };
}

// ---------- Entry (parlay) math ----------

// Distribution of the number of winning legs for independent legs (Poisson-binomial).
export function hitDistribution(probs) {
  let dist = [1];
  for (const p of probs) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

// Correlated version: legs in the same game share a latent factor (one-factor Gaussian copula).
// rho in [0, 1). Monte Carlo, seeded so results are stable between renders.
export function hitDistributionCorrelated(probs, groups, rho, trials = 40000, seed = 12345) {
  if (!(rho > 0)) return hitDistribution(probs);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = rand() || 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const thresholds = probs.map((p) => invNormal(p));
  const groupIds = [...new Set(groups)];
  const a = Math.sqrt(rho);
  const b = Math.sqrt(1 - rho);
  const counts = new Array(probs.length + 1).fill(0);
  for (let t = 0; t < trials; t++) {
    const factors = {};
    for (const g of groupIds) factors[g] = gauss();
    let hits = 0;
    for (let i = 0; i < probs.length; i++) {
      const z = groups[i] == null ? gauss() : a * factors[groups[i]] + b * gauss();
      if (z < thresholds[i]) hits++;
    }
    counts[hits]++;
  }
  return counts.map((c) => c / trials);
}

// Acklam's inverse normal CDF approximation.
export function invNormal(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * payoutTiers: { [hits]: multiplier } — e.g. standard 3-pick {3: 6}, flex 4-pick {4: 6, 3: 1.5}.
 * boost: product of per-pick multipliers (Underdog shows these on some lines), applied to every tier.
 * Returns per-unit-stake stats.
 */
export function entryStats(dist, payoutTiers, boost = 1) {
  let expReturn = 0;
  let pProfit = 0;
  let pAnyPayout = 0;
  dist.forEach((p, k) => {
    const m = (payoutTiers[k] ?? 0) * boost;
    expReturn += p * m;
    if (m > 1) pProfit += p;
    if (m > 0) pAnyPayout += p;
  });
  return { expReturn, ev: expReturn - 1, pProfit, pAnyPayout };
}

// Per-leg win rate needed to break even on a standard (all-or-nothing) entry.
export function breakEvenStandard(n, multiplier) {
  return Math.pow(1 / multiplier, 1 / n);
}

// Per-leg win rate needed to break even on a tiered entry, assuming equal legs.
export function breakEvenTiered(n, payoutTiers, boost = 1) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const ev = entryStats(hitDistribution(new Array(n).fill(mid)), payoutTiers, boost).ev;
    if (ev < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Kelly fraction for a multi-outcome bet: maximize E[log(1 + f * (m_k - 1))].
export function kellyFraction(dist, payoutTiers, boost = 1) {
  const outcomes = dist.map((p, k) => ({ p, r: (payoutTiers[k] ?? 0) * boost - 1 }));
  if (entryStats(dist, payoutTiers, boost).ev <= 0) return 0;
  const growth = (f) => outcomes.reduce((a, o) => a + (o.p > 0 ? o.p * Math.log(Math.max(1e-12, 1 + f * o.r)) : 0), 0);
  let lo = 0;
  let hi = 0.999;
  for (let i = 0; i < 100; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (growth(m1) < growth(m2)) lo = m1;
    else hi = m2;
  }
  return (lo + hi) / 2;
}

export function combinations(n, k) {
  const out = [];
  const idx = [];
  const rec = (start) => {
    if (idx.length === k) {
      out.push(idx.slice());
      return;
    }
    for (let i = start; i <= n - (k - idx.length); i++) {
      idx.push(i);
      rec(i + 1);
      idx.pop();
    }
  };
  rec(0);
  return out;
}
