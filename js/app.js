import * as M from './math.js';
import { listEvents, fetchEventPicks, MARKETS } from './oddsapi.js';
import { loadState, saveState, DEFAULT_SETTINGS, DEFAULT_PAYOUTS } from './storage.js';
import { SAMPLE_PICKS } from './sample.js';

let state = loadState();
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);

const save = () => saveState(state);
const pct = (p, d = 1) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
const money = (x) => (x == null ? '—' : `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`);
const signedPct = (x, d = 1) => {
  if (x == null) return '—';
  const r = Number((x * 100).toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '' : '±'}${(r === 0 ? 0 : r).toFixed(d)}%`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtLine = (n) => (Number.isFinite(n) ? (Number.isInteger(n) ? n.toFixed(0) : String(n)) : '—');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Payout helpers ----------

function payoutTiers(type, n) {
  const p = state.settings.payouts;
  if (type === 'standard') return p.standard[n] ? { [n]: p.standard[n] } : null;
  return p.flex[n] ?? null;
}

// The lowest per-leg win rate needed to break even across all configured entries.
// A pick that clears this can be part of a +EV entry; one that doesn't, can't help.
function bestBreakEven() {
  let best = { be: 1, label: '' };
  for (const [n, mult] of Object.entries(state.settings.payouts.standard)) {
    const be = M.breakEvenStandard(+n, mult);
    if (be < best.be) best = { be, label: `${n}-pick standard` };
  }
  for (const [n, tiers] of Object.entries(state.settings.payouts.flex)) {
    const be = M.breakEvenTiered(+n, tiers);
    if (be < best.be) best = { be, label: `${n}-pick flex` };
  }
  return best;
}
let BE = bestBreakEven();

// ---------- Pick evaluation ----------

function evaluate(pick) {
  const est = M.estimatePick(pick, state.settings.weights, state.settings.shrink);
  if (!est) return { pick, est: null, rating: 'none' };
  const pOver = est.pOver;
  const mH = pick.multHigher || 1;
  const mL = pick.multLower || 1;
  // A pick's contribution to a standard entry's EV is p * multiplier, so compare sides on that.
  let side = pick.side;
  if (side !== 'over' && side !== 'under') side = pOver * mH >= (1 - pOver) * mL ? 'over' : 'under';
  const p = side === 'over' ? pOver : 1 - pOver;
  const mult = side === 'over' ? mH : mL;
  const value = p * mult;
  const edge = value - BE.be;
  const rating = edge >= 0.04 ? 'strong' : edge >= 0 ? 'playable' : edge >= -0.02 ? 'marginal' : 'pass';
  return { pick, est, side, p, mult, value, edge, rating };
}

const RATING_LABEL = { strong: 'Strong', playable: 'Playable', marginal: 'Marginal', pass: 'Pass', none: 'Need data' };

function sourceTags(ev) {
  if (!ev.est) return '<span class="sub">add odds, projection or logs</span>';
  return ev.est.sources
    .map((s) => {
      const title =
        s.name === 'history' ? `Went over in ${s.hits}/${s.n} recent games` : `${s.name}: ${pct(s.pOver)} over`;
      const label = s.name === 'history' ? `logs ${s.hits}/${s.n}` : s.name === 'model' ? 'proj' : 'market';
      return `<span class="src" title="${esc(title)}">${label}</span>`;
    })
    .join('');
}

// ---------- Board ----------

function renderBoard() {
  const sport = $('#filter-sport').value;
  const ratingFilter = $('#filter-rating').value;
  const q = $('#filter-search').value.trim().toLowerCase();
  const rows = state.picks
    .map(evaluate)
    .filter((ev) => !sport || ev.pick.sport === sport)
    .filter((ev) => {
      if (ratingFilter === 'strong') return ev.rating === 'strong';
      if (ratingFilter === 'playable') return ev.rating === 'strong' || ev.rating === 'playable';
      return true;
    })
    .filter((ev) => !q || `${ev.pick.player} ${ev.pick.game} ${ev.pick.team}`.toLowerCase().includes(q))
    .sort((a, b) => (b.edge ?? -9) - (a.edge ?? -9));

  $('#board-hint').innerHTML = state.picks.length
    ? `A pick needs to win at least <b>${pct(BE.be)}</b> of the time to help an entry (break-even for a ${BE.label}). Sorted by edge over that bar.`
    : '';

  if (!state.picks.length) {
    $('#board-table').innerHTML = `<div class="card empty">
      <p><b>No picks yet.</b></p>
      <p>Add lines from the Underdog app with <b>+ Add pick</b>, paste many at once with <b>Import CSV</b>,
      or pull them automatically with <b>Fetch live lines</b> (needs a free Odds API key in Settings).</p>
      <p>Want to look around first? <button class="btn" data-action="demo">Load sample picks</button></p></div>`;
    return;
  }

  const body = rows
    .map((ev) => {
      const p = ev.pick;
      const info = M.statInfo(p.sport, p.stat);
      const sideBtns = `<span class="side-toggle" role="group" aria-label="Side">
        <button data-action="side" data-side="over" data-id="${p.id}" class="${ev.side === 'over' ? 'on' : ''}" title="${p.side === 'auto' ? 'Auto-picked' : 'Locked'}">Higher${p.multHigher && p.multHigher !== 1 ? ` ${p.multHigher}x` : ''}</button>
        <button data-action="side" data-side="under" data-id="${p.id}" class="${ev.side === 'under' ? 'on' : ''}">Lower${p.multLower && p.multLower !== 1 ? ` ${p.multLower}x` : ''}</button>
      </span>`;
      return `<tr class="${p.selected ? 'selected' : ''}">
        <td class="c-sel"><input type="checkbox" data-action="select" data-id="${p.id}" ${p.selected ? 'checked' : ''} aria-label="Add to entry" /></td>
        <td class="c-player"><div class="player">${esc(p.player)}</div><div class="sub">${esc(p.sport)}${p.team ? ' · ' + esc(p.team) : ''}${p.game ? ' · ' + esc(p.game) : ''}</div></td>
        <td class="c-line"><div>${esc(info?.label ?? p.stat)} <b>${fmtLine(p.line)}</b></div><div>${sideBtns}</div></td>
        <td class="c-prob num"><b>${ev.est ? pct(ev.p) : '—'}</b><div class="sub">win</div></td>
        <td class="c-edge num ${ev.edge >= 0 ? 'pos' : 'neg'}">${ev.est ? signedPct(ev.edge) : '—'}</td>
        <td class="c-rating"><span class="badge ${ev.rating}">${RATING_LABEL[ev.rating]}</span></td>
        <td class="c-src">${sourceTags(ev)}</td>
        <td class="c-act num"><button class="btn small ghost" data-action="edit" data-id="${p.id}">Edit</button><button class="btn small ghost danger" data-action="delete" data-id="${p.id}" aria-label="Delete">✕</button></td>
      </tr>`;
    })
    .join('');

  $('#board-table').innerHTML = `<div class="board-table"><div class="table-wrap"><table>
    <thead><tr><th></th><th>Player</th><th>Line &amp; pick</th><th class="num">Win %</th><th class="num">Edge</th><th>Rating</th><th>Based on</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="8" class="empty">No picks match the filters.</td></tr>'}</tbody></table></div></div>`;
}

function onBoardClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const pick = state.picks.find((p) => p.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'select':
      pick.selected = el.checked;
      break;
    case 'side':
      // Clicking the auto-chosen side again returns it to auto.
      pick.side = pick.side === el.dataset.side ? 'auto' : el.dataset.side;
      break;
    case 'edit':
      openPickDialog(pick);
      return;
    case 'delete':
      state.picks = state.picks.filter((p) => p !== pick);
      break;
    case 'demo':
      loadSample();
      return;
    default:
      return;
  }
  save();
  renderAll();
}

function loadSample() {
  const existing = new Set(state.picks.map((p) => `${p.player}|${p.stat}`));
  for (const s of SAMPLE_PICKS) {
    if (!existing.has(`${s.player}|${s.stat}`)) state.picks.push(normalizePick({ ...s, note: 'Sample data — not real lines' }));
  }
  save();
  renderAll();
  toast('Sample picks loaded — these are made-up lines for trying the tool');
}

function normalizePick(raw) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    id: raw.id ?? uid(),
    sport: raw.sport,
    player: String(raw.player ?? '').trim(),
    team: String(raw.team ?? '').trim(),
    game: String(raw.game ?? '').trim(),
    stat: raw.stat,
    line: num(raw.line),
    side: raw.side ?? 'auto',
    multHigher: num(raw.multHigher) ?? 1,
    multLower: num(raw.multLower) ?? 1,
    overOdds: num(raw.overOdds),
    underOdds: num(raw.underOdds),
    marketMean: num(raw.marketMean),
    marketBooks: raw.marketBooks ?? [],
    projection: num(raw.projection),
    logs: Array.isArray(raw.logs) ? raw.logs.map(Number).filter(Number.isFinite) : parseLogs(raw.logs),
    note: raw.note ?? '',
    startTime: raw.startTime ?? null,
    selected: !!raw.selected,
  };
}

function parseLogs(text) {
  if (!text) return [];
  return String(text)
    .split(/[\s,;|]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

// ---------- Pick dialog ----------

let editingId = null;

function fillStatOptions(sport, selected) {
  const sel = $('#pick-form [name=stat]');
  sel.innerHTML = Object.entries(M.SPORTS[sport].stats)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v.label}</option>`)
    .join('');
}

function openPickDialog(pick) {
  editingId = pick?.id ?? null;
  const f = $('#pick-form');
  f.reset();
  $('#pick-dialog-title').textContent = pick ? 'Edit pick' : 'Add pick';
  const p = pick ?? { sport: 'NFL', stat: 'pass_yds', side: 'auto', multHigher: 1, multLower: 1 };
  f.sport.value = p.sport;
  fillStatOptions(p.sport, p.stat);
  for (const k of ['player', 'team', 'game', 'line', 'multHigher', 'multLower', 'overOdds', 'underOdds', 'projection', 'note']) {
    f[k].value = p[k] ?? '';
  }
  f.side.value = p.side ?? 'auto';
  f.logs.value = (p.logs ?? []).join(' ');
  // Odds pulled from the API with a different line are summarized as marketMean; show that.
  f.dataset.marketMean = pick?.marketMean ?? '';
  updatePickPreview();
  $('#pick-dialog').showModal();
}

function pickFromForm() {
  const f = $('#pick-form');
  const raw = Object.fromEntries(new FormData(f));
  const prev = state.picks.find((p) => p.id === editingId);
  const pick = normalizePick({ ...raw, id: editingId ?? undefined, selected: prev?.selected });
  // Keep an API consensus unless the user typed their own odds or changed what is being bet.
  const changedBet = prev && (prev.line !== pick.line || prev.stat !== pick.stat || prev.sport !== pick.sport);
  if (prev && !changedBet && pick.overOdds == null && pick.underOdds == null) {
    pick.marketMean = prev.marketMean;
    pick.marketBooks = prev.marketBooks;
  }
  if (prev) pick.startTime = prev.startTime;
  return pick;
}

function updatePickPreview() {
  const pick = pickFromForm();
  const box = $('#pick-preview');
  if (!pick.player || pick.line == null) {
    box.innerHTML = '<span class="sub">Fill in player and line to see the estimate.</span>';
    return;
  }
  const ev = evaluate(pick);
  if (!ev.est) {
    box.innerHTML = '<span class="sub">Add sportsbook odds, a projection, or recent game values to get a win probability.</span>';
    return;
  }
  const parts = ev.est.sources.map((s) => {
    if (s.name === 'history') return `Logs: over in ${s.hits}/${s.n} → ${pct(s.pOver)}`;
    if (s.name === 'model') return `Projection: ${pct(s.pOver)} over`;
    return `Market (no-vig): ${pct(s.pOver)} over`;
  });
  const fair = M.probToAmerican(ev.p);
  box.innerHTML = `<b>${ev.side === 'over' ? 'Higher' : 'Lower'} ${fmtLine(pick.line)}: ${pct(ev.p)} to win</b>
    (fair odds ${fair > 0 ? '+' : ''}${fair}) · <span class="badge ${ev.rating}">${RATING_LABEL[ev.rating]}</span>
    <div class="sub">${parts.join(' · ')} · break-even ${pct(BE.be)}</div>`;
}

function savePickFromDialog() {
  const pick = pickFromForm();
  if (!pick.player || pick.line == null) return toast('Player and line are required');
  const i = state.picks.findIndex((p) => p.id === pick.id);
  if (i >= 0) state.picks[i] = pick;
  else state.picks.push(pick);
  save();
  renderAll();
  toast(i >= 0 ? 'Pick updated' : 'Pick added');
}

// ---------- CSV import ----------

function findStatKey(sport, text) {
  const stats = M.SPORTS[sport]?.stats;
  if (!stats) return null;
  const t = String(text).trim().toLowerCase().replace(/[^a-z0-9+]/g, '');
  if (!t) return null;
  for (const [k, v] of Object.entries(stats)) {
    if (k.replace(/_/g, '') === t || v.label.toLowerCase().replace(/[^a-z0-9+]/g, '') === t) return k;
  }
  const aliases = {
    pts: 'points', reb: 'rebounds', rebs: 'rebounds', ast: 'assists', asts: 'assists', '3pm': 'threes', '3ptm': 'threes',
    threepointersmade: 'threes', ptsrebast: 'pra', 'pts+reb+ast': 'pra', 'points+rebounds+assists': 'pra',
    'pts+reb': 'pts_reb', 'pts+ast': 'pts_ast', 'reb+ast': 'reb_ast', 'blks+stls': 'blk_stl', 'stl+blk': 'blk_stl',
    passingyards: 'pass_yds', passyds: 'pass_yds', rushingyards: 'rush_yds', rushyds: 'rush_yds',
    receivingyards: 'rec_yds', recyds: 'rec_yds', rec: 'receptions', passingtds: 'pass_tds', passingtouchdowns: 'pass_tds',
    'rush+recyds': 'rush_rec_yds', rushingreceivingyards: 'rush_rec_yds', 'pass+rushyds': 'pass_rush_yds',
    passattempts: 'pass_att', rushattempts: 'rush_att', fantasypoints: 'fantasy_pts', fpts: 'fantasy_pts',
    'rush+rectds': 'rush_rec_tds', touchdowns: 'rush_rec_tds', tds: 'rush_rec_tds',
  };
  const a = aliases[t];
  return a && stats[a] ? a : null;
}

function normalizeSport(s) {
  const t = String(s).trim().toUpperCase();
  if (['NFL'].includes(t)) return 'NFL';
  if (['CFB', 'NCAAF', 'CBF', 'COLLEGE FOOTBALL', 'CFOOT'].includes(t)) return 'CFB';
  if (['NBA'].includes(t)) return 'NBA';
  return null;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === ',' || ch === '\t') && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function importCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const added = [];
  const errors = [];
  lines.forEach((line, i) => {
    const c = splitCsvLine(line);
    if (i === 0 && c[0]?.toLowerCase() === 'sport') return;
    const sport = normalizeSport(c[0]);
    const stat = sport && findStatKey(sport, c[4]);
    const lineVal = Number(c[5]);
    if (!sport || !c[1] || !stat || !Number.isFinite(lineVal)) {
      errors.push(`Line ${i + 1}: ${!sport ? 'unknown sport' : !stat ? `unknown stat "${c[4] ?? ''}"` : 'missing player or line'}`);
      return;
    }
    added.push(
      normalizePick({
        sport, player: c[1], team: c[2], game: c[3], stat, line: lineVal,
        overOdds: c[6], underOdds: c[7], projection: c[8], logs: c[9], multHigher: c[10], multLower: c[11],
      })
    );
  });
  state.picks.push(...added);
  save();
  renderAll();
  return { added: added.length, errors };
}

// ---------- Entry ----------

function selectedEvals() {
  return state.picks.filter((p) => p.selected).map(evaluate);
}

function gameKey(pick) {
  return (pick.gameId || pick.game || pick.team || '').toLowerCase() || null;
}

function analyzeEntry(evals, type) {
  const n = evals.length;
  const tiers = payoutTiers(type, n);
  if (!tiers || evals.some((e) => !e.est)) return { n, tiers: null };
  const probs = evals.map((e) => e.p);
  const boost = evals.reduce((a, e) => a * e.mult, 1);
  const groups = evals.map((e) => gameKey(e.pick));
  const dist = M.hitDistributionCorrelated(probs, groups, state.settings.rho);
  const stats = M.entryStats(dist, tiers, boost);
  const kelly = M.kellyFraction(dist, tiers, boost);
  const be = type === 'standard' ? M.breakEvenStandard(n, tiers[n] * boost) : M.breakEvenTiered(n, tiers, boost);
  return { n, tiers, boost, dist, ...stats, kelly, be, probs };
}

function entryWarnings(evals) {
  const w = [];
  const games = evals.map((e) => gameKey(e.pick)).filter(Boolean);
  const dupGames = games.filter((g, i) => games.indexOf(g) !== i);
  if (dupGames.length && !(state.settings.rho > 0))
    w.push('Some picks are from the same game, so their results are linked. Set "Same-game correlation" in Settings to model it.');
  const teams = evals.map((e) => e.pick.team).filter(Boolean);
  if (teams.length === evals.length && new Set(teams).size === 1 && evals.length > 1)
    w.push('All picks are on one team — Underdog requires players from at least two teams.');
  const players = evals.map((e) => e.pick.player.toLowerCase());
  if (new Set(players).size !== players.length) w.push('The same player appears twice — Underdog may not allow this.');
  if (evals.some((e) => Number.isInteger(e.pick.line))) w.push('Whole-number lines can push (tie). A pushed pick is removed and the entry pays as one size smaller.');
  return w;
}

function recommendedStake(kelly) {
  const s = state.settings;
  const k = kelly * s.kellyFraction * s.bankroll;
  return Math.max(0, Math.min(k, (s.maxStakePct / 100) * s.bankroll));
}

function renderEntry() {
  const evals = selectedEvals();
  const type = state.entry.type;
  $('#entry-type').value = type;
  if (document.activeElement !== $('#entry-stake')) $('#entry-stake').value = state.entry.stake ?? state.settings.defaultStake;
  $('#entry-count').textContent = evals.length;

  $('#entry-picks').innerHTML = evals.length
    ? evals
        .map(
          (e) => `<div class="entry-pick"><div><div class="player">${esc(e.pick.player)}</div>
          <div class="sub">${e.side === 'over' ? 'Higher' : e.side === 'under' ? 'Lower' : '?'} ${fmtLine(e.pick.line)} ${esc(M.statInfo(e.pick.sport, e.pick.stat)?.label ?? '')}${e.mult !== 1 && e.est ? ` · ${e.mult}x` : ''}</div></div>
          <div class="num"><b>${e.est ? pct(e.p) : 'no data'}</b> <span class="badge ${e.rating}">${RATING_LABEL[e.rating]}</span>
          <button class="btn small ghost" data-action="unselect" data-id="${e.pick.id}" aria-label="Remove">✕</button></div></div>`
        )
        .join('')
    : '<div class="empty">Tick picks on the Board (or use Best entries) to build an entry.</div>';

  const out = $('#entry-results');
  if (evals.length < 2) {
    out.innerHTML = '<div class="empty">Select 2–6 picks to see the odds of your entry.</div>';
    return;
  }
  if (evals.some((e) => !e.est)) {
    out.innerHTML = '<div class="verdict warn">Some selected picks have no data yet. Edit them to add odds, a projection or game logs.</div>';
    return;
  }
  const a = analyzeEntry(evals, type);
  if (!a.tiers) {
    out.innerHTML = `<div class="verdict warn">No ${type} payout is set for ${evals.length} picks. Check Settings → Payout tables${type === 'flex' && evals.length < 3 ? ' (flex needs 3+ picks)' : ''}.</div>`;
    return;
  }
  const stake = Number(state.entry.stake ?? state.settings.defaultStake) || 0;
  const rec = recommendedStake(a.kelly);
  const top = a.tiers[a.n] * a.boost;
  const verdictClass = a.ev > 0.05 ? 'good' : a.ev > -0.05 ? 'warn' : 'bad';
  const verdictText =
    a.ev > 0.05
      ? `Positive expected value: about ${signedPct(a.ev)} return per dollar over the long run.`
      : a.ev > 0
        ? `Slightly positive — roughly a coin flip against the house edge (${signedPct(a.ev)}).`
        : a.ev > -0.05
          ? `Close to break-even (${signedPct(a.ev)}). Small edges are easily wrong — consider stronger picks.`
          : `Negative expected value (${signedPct(a.ev)}). On average this entry loses money.`;

  const warnings = entryWarnings(evals);
  out.innerHTML = `
    <div class="verdict ${verdictClass}">${verdictText}</div>
    <div class="tiles">
      <div class="tile"><div class="label">${type === 'standard' ? 'Chance all hit' : 'Chance of a max payout'}</div><div class="value">${pct(a.dist[a.n])}</div><div class="note">pays ${top.toFixed(2)}x</div></div>
      <div class="tile"><div class="label">Chance to profit</div><div class="value">${pct(a.pProfit)}</div><div class="note">about 1 in ${a.pProfit > 0 ? (1 / a.pProfit).toFixed(1) : '∞'}</div></div>
      <div class="tile"><div class="label">Expected return</div><div class="value ${a.ev >= 0 ? 'pos' : 'neg'}">${money(stake * a.ev)}</div><div class="note">on ${money(stake)} stake</div></div>
      <div class="tile"><div class="label">Break-even per pick</div><div class="value">${pct(a.be)}</div><div class="note">your avg ${pct(a.probs.reduce((x, y) => x + y, 0) / a.n)}</div></div>
    </div>
    <h3>Payout by number of hits</h3>
    ${distChart(a.dist, a.tiers, a.boost, stake)}
    <h3>Suggested stake</h3>
    <p class="hint">${
      a.kelly > 0
        ? `${(state.settings.kellyFraction * 100).toFixed(0)}% Kelly on a ${money(state.settings.bankroll)} bankroll suggests <b>${money(rec)}</b>${rec >= (state.settings.maxStakePct / 100) * state.settings.bankroll - 0.005 ? ` (capped at ${state.settings.maxStakePct}% of bankroll)` : ''}.`
        : 'Kelly suggests <b>$0</b> — the math says this entry doesn\'t beat the payout.'
    }</p>
    ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <p class="hint">Results assume the win probabilities are right. They're estimates — track your results to see how well calibrated they are.</p>`;
  bindChartTips(out);
}

// Bar chart: probability of each hit count; bars that pay out are highlighted.
function distChart(dist, tiers, boost, stake) {
  const W = 420, H = 170, padL = 34, padB = 34, padT = 10, padR = 6;
  const n = dist.length;
  const maxP = Math.max(...dist, 0.01);
  const step = maxP > 0.4 ? 0.2 : maxP > 0.2 ? 0.1 : 0.05;
  const yMax = Math.min(1, Math.ceil(maxP / step) * step);
  const bw = (W - padL - padR) / n;
  const y = (p) => padT + (H - padT - padB) * (1 - p / yMax);
  let grid = '';
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    grid += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 4}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  }
  const bars = dist
    .map((p, k) => {
      const m = (tiers[k] ?? 0) * boost;
      const x = padL + k * bw + bw * 0.18;
      const w = bw * 0.64;
      const top = y(p);
      const h = Math.max(0, y(0) - top);
      const r = Math.min(4, w / 2, h);
      const path = h > 0
        ? `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y(0)} Z`
        : '';
      const tip = `${k} of ${n - 1} hit: ${pct(p)} chance — ${m > 0 ? `pays ${m.toFixed(2)}x (${money(stake * m)})` : 'loses stake'}`;
      return `<g><rect class="hit" x="${padL + k * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent" data-tip="${esc(tip)}"/>
        <path class="bar ${m > 0 ? 'hi' : ''}" d="${path}" pointer-events="none"/>
        <text x="${padL + k * bw + bw / 2}" y="${H - padB + 14}" text-anchor="middle">${k} hit</text>
        <text x="${padL + k * bw + bw / 2}" y="${H - padB + 27}" text-anchor="middle">${m > 0 ? m.toFixed(2) + 'x' : '—'}</text></g>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability of each number of winning picks">${grid}${bars}</svg>
    <p class="sub">Green bars pay out. Hover a bar for details.</p>`;
}

function bindChartTips(root) {
  let tip = $('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.append(tip);
  }
  $$('[data-tip]', root).forEach((el) => {
    const show = (e) => {
      tip.textContent = el.dataset.tip;
      tip.style.display = 'block';
      const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${e.clientY - 34}px`;
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => (tip.style.display = 'none'));
  });
}

function logEntry() {
  const evals = selectedEvals();
  const a = analyzeEntry(evals, state.entry.type);
  if (evals.length < 2 || !a.tiers) return toast('Build a valid entry first');
  const stake = Number(state.entry.stake ?? state.settings.defaultStake) || 0;
  state.log.unshift({
    id: uid(),
    date: new Date().toISOString(),
    type: state.entry.type,
    stake,
    tiers: a.tiers,
    boost: a.boost,
    predictedEv: a.ev,
    predictedAll: a.dist[a.n],
    picks: evals.map((e) => ({
      player: e.pick.player, sport: e.pick.sport, stat: e.pick.stat, line: e.pick.line, side: e.side, p: e.p, result: null,
    })),
    status: 'pending',
    returned: null,
  });
  save();
  renderTracker();
  toast('Saved to tracker — mark results there after the games');
}

// ---------- Optimizer ----------

function runOptimizer() {
  const sizes = $$('#opt-sizes input:checked').map((i) => +i.value);
  const typeSel = $('#opt-type').value;
  const types = typeSel === 'both' ? ['standard', 'flex'] : [typeSel];
  const rankBy = $('#opt-rank').value;
  const onePerGame = $('#opt-one-per-game').checked;

  // Keep the pool small enough to enumerate: best 22 picks by value.
  const pool = state.picks
    .map(evaluate)
    .filter((e) => e.est)
    .sort((a, b) => b.value - a.value)
    .slice(0, 22);
  if (pool.length < 2) {
    $('#opt-results').innerHTML = '<div class="empty">Need at least 2 picks with data on the Board.</div>';
    return;
  }

  const results = [];
  const keep = 15;
  const score = (r) => (rankBy === 'kelly' ? r.growth : rankBy === 'prob' ? r.pProfit : r.ev);
  for (const n of sizes) {
    if (n > pool.length) continue;
    for (const combo of M.combinations(pool.length, n)) {
      const evals = combo.map((i) => pool[i]);
      const players = new Set(evals.map((e) => e.pick.player.toLowerCase()));
      if (players.size < n) continue;
      const teams = evals.map((e) => e.pick.team).filter(Boolean);
      if (teams.length === n && new Set(teams).size < 2) continue;
      if (onePerGame) {
        const games = evals.map((e) => gameKey(e.pick)).filter(Boolean);
        if (new Set(games).size < games.length) continue;
      }
      for (const type of types) {
        const tiers = payoutTiers(type, n);
        if (!tiers) continue;
        const probs = evals.map((e) => e.p);
        const boost = evals.reduce((a, e) => a * e.mult, 1);
        // Independent math here for speed; the Entry tab applies correlation.
        const dist = M.hitDistribution(probs);
        const st = M.entryStats(dist, tiers, boost);
        if (rankBy === 'ev' && results.length >= keep && st.ev <= score(results[results.length - 1])) continue;
        const kelly = rankBy === 'kelly' ? M.kellyFraction(dist, tiers, boost) : 0;
        const growth = kelly > 0 ? dist.reduce((acc, p, k) => acc + p * Math.log(1 + kelly * ((tiers[k] ?? 0) * boost - 1)), 0) : 0;
        const r = { ids: evals.map((e) => e.pick.id), evals, type, n, ...st, growth, top: tiers[n] * boost, pAll: dist[n] };
        results.push(r);
        results.sort((a, b) => score(b) - score(a));
        if (results.length > keep) results.pop();
      }
    }
  }

  if (!results.length) {
    $('#opt-results').innerHTML = '<div class="empty">No valid entries found for these settings.</div>';
    return;
  }
  const anyPositive = results.some((r) => r.ev > 0);
  $('#opt-results').innerHTML = `
    ${anyPositive ? '' : '<div class="verdict bad">None of these entries are +EV with your current estimates. The best play may be no play.</div>'}
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Picks</th><th>Type</th><th class="num">All hit</th><th class="num">Profit chance</th><th class="num">EV / $1</th><th></th></tr></thead>
      <tbody>${results
        .map(
          (r, i) => `<tr><td>${i + 1}</td>
          <td>${r.evals.map((e) => `<div><b>${esc(e.pick.player)}</b> <span class="sub">${e.side === 'over' ? 'Higher' : 'Lower'} ${fmtLine(e.pick.line)} ${esc(M.statInfo(e.pick.sport, e.pick.stat)?.label ?? '')} · ${pct(e.p, 0)}</span></div>`).join('')}</td>
          <td>${r.n}-pick ${r.type}<div class="sub">${r.top.toFixed(2)}x max</div></td>
          <td class="num">${pct(r.pAll)}</td>
          <td class="num">${pct(r.pProfit)}</td>
          <td class="num ${r.ev >= 0 ? 'pos' : 'neg'}">${signedPct(r.ev)}</td>
          <td><button class="btn small" data-action="use" data-i="${i}">Use</button></td></tr>`
        )
        .join('')}</tbody></table></div>
    <p class="hint">Combinations of picks are treated as independent here. Many entries share the same top picks — spreading money across them doesn't spread risk much.</p>`;
  $('#opt-results').onclick = (e) => {
    const b = e.target.closest('[data-action=use]');
    if (!b) return;
    const r = results[+b.dataset.i];
    state.picks.forEach((p) => (p.selected = r.ids.includes(p.id)));
    state.entry.type = r.type;
    save();
    renderAll();
    showTab('entry');
  };
}

// ---------- Tracker ----------

function settleEntry(entry) {
  const results = entry.picks.map((p) => p.result);
  if (results.some((r) => r == null)) return;
  const live = entry.picks.filter((p) => p.result !== 'push');
  const hits = live.filter((p) => p.result === 'hit').length;
  const n = live.length;
  // A push drops the entry to the next size down; use that size's payout table when we have it.
  let tiers = entry.tiers;
  if (n !== entry.picks.length) tiers = payoutTiers(entry.type, n) ?? (entry.type === 'standard' ? null : {});
  const mult = n < 2 ? 1 : (tiers?.[hits] ?? 0) * (entry.boost ?? 1);
  entry.returned = +(entry.stake * mult).toFixed(2);
  entry.status = entry.returned > entry.stake ? 'won' : entry.returned > 0 ? 'partial' : 'lost';
}

function renderTracker() {
  const log = state.log;
  const settled = log.filter((e) => e.status !== 'pending');
  const staked = settled.reduce((a, e) => a + e.stake, 0);
  const returned = settled.reduce((a, e) => a + (e.returned ?? 0), 0);
  const expected = settled.reduce((a, e) => a + e.stake * e.predictedEv, 0);
  const profit = returned - staked;
  $('#tracker-summary').innerHTML = `
    <div class="tile"><div class="label">Entries settled</div><div class="value">${settled.length}</div><div class="note">${log.length - settled.length} pending</div></div>
    <div class="tile"><div class="label">Profit</div><div class="value ${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</div><div class="note">on ${money(staked)} staked</div></div>
    <div class="tile"><div class="label">ROI</div><div class="value ${profit >= 0 ? 'pos' : 'neg'}">${staked ? signedPct(profit / staked) : '—'}</div><div class="note">return per $ staked</div></div>
    <div class="tile"><div class="label">Expected profit</div><div class="value">${money(expected)}</div><div class="note">what the model predicted</div></div>`;

  // Cumulative profit chart, oldest first.
  const series = settled.slice().reverse();
  if (series.length < 2) {
    $('#tracker-chart').innerHTML = '<div class="empty">Settle at least 2 entries to see your trend.</div>';
  } else {
    let cum = 0;
    const pts = [{ x: 0, y: 0, label: 'Start' }].concat(
      series.map((e, i) => {
        cum += (e.returned ?? 0) - e.stake;
        return { x: i + 1, y: cum, label: `${new Date(e.date).toLocaleDateString()} · ${e.picks.length}-pick ${e.type}: ${money((e.returned ?? 0) - e.stake)} (total ${money(cum)})` };
      })
    );
    const W = 420, H = 170, padL = 48, padB = 18, padT = 10, padR = 8;
    const ys = pts.map((p) => p.y);
    let lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
    if (hi === lo) hi = lo + 1;
    const sx = (x) => padL + ((W - padL - padR) * x) / (pts.length - 1);
    const sy = (y) => padT + ((H - padT - padB) * (hi - y)) / (hi - lo);
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      grid += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${padL - 4}" y="${sy(v) + 4}" text-anchor="end">${money(v).replace('.00', '')}</text>`;
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join(' ');
    const last = pts[pts.length - 1];
    const hits = pts
      .map((p) => `<rect x="${sx(p.x) - 8}" y="${padT}" width="16" height="${H - padT - padB}" fill="transparent" data-tip="${esc(p.label)}"/>`)
      .join('');
    $('#tracker-chart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative profit">
      ${grid}<line class="zero" x1="${padL}" x2="${W - padR}" y1="${sy(0)}" y2="${sy(0)}"/>
      <path class="line" d="${d}"/><circle class="dot" cx="${sx(last.x)}" cy="${sy(last.y)}" r="4"/>${hits}</svg>`;
    bindChartTips($('#tracker-chart'));
  }

  // Calibration buckets for individual picks.
  const buckets = [
    [0, 0.55, '< 55%'],
    [0.55, 0.6, '55–60%'],
    [0.6, 0.65, '60–65%'],
    [0.65, 1.01, '65%+'],
  ].map(([lo, hi, label]) => ({ lo, hi, label, n: 0, hits: 0, sumP: 0 }));
  for (const e of log) for (const p of e.picks) {
    if (p.result !== 'hit' && p.result !== 'miss') continue;
    const b = buckets.find((b) => p.p >= b.lo && p.p < b.hi);
    b.n++;
    b.sumP += p.p;
    if (p.result === 'hit') b.hits++;
  }
  const anyCal = buckets.some((b) => b.n);
  $('#tracker-calibration').innerHTML = anyCal
    ? `<table><thead><tr><th>Predicted</th><th class="num">Picks</th><th class="num">Expected hit</th><th class="num">Actual hit</th></tr></thead><tbody>${buckets
        .map((b) => `<tr><td>${b.label}</td><td class="num">${b.n}</td><td class="num">${b.n ? pct(b.sumP / b.n) : '—'}</td><td class="num">${b.n ? pct(b.hits / b.n) : '—'}</td></tr>`)
        .join('')}</tbody></table><p class="hint">Small samples swing a lot — you need 100+ picks before reading much into this.</p>`
    : '<div class="empty">No pick results yet.</div>';

  $('#tracker-list').innerHTML = log.length
    ? log
        .map(
          (e) => `<div class="log-entry">
        <div class="log-head">
          <div><b>${e.picks.length}-pick ${e.type}</b> <span class="sub">${new Date(e.date).toLocaleDateString()} · model EV ${signedPct(e.predictedEv)}</span></div>
          <div class="num">${money(e.stake)} → ${e.status === 'pending' ? '<span class="badge none">pending</span>' : `<b class="${e.returned - e.stake >= 0 ? 'pos' : 'neg'}">${money(e.returned)}</b>`}
          <button class="btn small ghost danger" data-action="delete-entry" data-e="${e.id}" aria-label="Delete entry">✕</button></div>
        </div>
        ${e.picks
          .map(
            (p, i) => `<div class="entry-pick"><span><b>${esc(p.player)}</b> <span class="sub">${p.side === 'over' ? 'Higher' : 'Lower'} ${fmtLine(p.line)} ${esc(M.statInfo(p.sport, p.stat)?.label ?? p.stat)} · ${pct(p.p, 0)}</span></span>
          <span class="side-toggle">${['hit', 'miss', 'push']
            .map((r) => `<button data-action="result" data-e="${e.id}" data-i="${i}" data-r="${r}" class="${p.result === r ? 'on' : ''}">${r}</button>`)
            .join('')}</span></div>`
          )
          .join('')}
      </div>`
        )
        .join('')
    : '<div class="empty">No entries yet. Build one on the Entry tab and press "Save to tracker".</div>';
}

function onTrackerClick(e) {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const entry = state.log.find((x) => x.id === b.dataset.e);
  if (!entry) return;
  if (b.dataset.action === 'result') {
    const pick = entry.picks[+b.dataset.i];
    pick.result = pick.result === b.dataset.r ? null : b.dataset.r;
    entry.status = 'pending';
    entry.returned = null;
    settleEntry(entry);
  } else if (b.dataset.action === 'delete-entry') {
    if (!confirm('Delete this entry from the tracker?')) return;
    state.log = state.log.filter((x) => x !== entry);
  }
  save();
  renderTracker();
}

// ---------- Settings ----------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = val;
}

function renderSettings() {
  $$('[data-setting]').forEach((el) => {
    const v = getPath(state.settings, el.dataset.setting);
    el.value = Array.isArray(v) ? v.join(', ') : v ?? '';
  });
  const p = state.settings.payouts;
  const sizes = [2, 3, 4, 5, 6];
  $('#payout-editor').innerHTML = `
    <h3>Standard — all picks must hit</h3>
    <table class="payout-table"><thead><tr><th>Picks</th>${sizes.map((n) => `<th>${n}</th>`).join('')}</tr></thead>
    <tbody><tr><td>Pays</td>${sizes.map((n) => `<td><input type="number" step="0.1" min="0" data-payout="standard.${n}" value="${p.standard[n] ?? ''}" aria-label="${n}-pick standard payout"/></td>`).join('')}</tr>
    <tr><td class="sub">Break-even</td>${sizes.map((n) => `<td class="sub">${p.standard[n] ? pct(M.breakEvenStandard(n, p.standard[n])) : '—'}</td>`).join('')}</tr></tbody></table>
    <h3>Flex — pays with misses</h3>
    <table class="payout-table"><thead><tr><th>Picks</th><th>All hit</th><th>1 miss</th><th>2 misses</th><th>Break-even</th></tr></thead><tbody>
    ${[3, 4, 5, 6]
      .map((n) => {
        const t = p.flex[n] ?? {};
        return `<tr><td>${n}</td>${[0, 1, 2]
          .map((m) => `<td><input type="number" step="0.05" min="0" data-payout="flex.${n}.${n - m}" value="${t[n - m] ?? ''}" aria-label="${n}-pick flex, ${m} misses"/></td>`)
          .join('')}<td class="sub">${Object.keys(t).length ? pct(M.breakEvenTiered(n, t)) : '—'}</td></tr>`;
      })
      .join('')}</tbody></table>`;
}

function onSettingChange(e) {
  const el = e.target;
  if (el.dataset.setting) {
    const key = el.dataset.setting;
    let v = el.value;
    if (key === 'sharpBooks') v = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (el.type === 'number') v = Number(v) || 0;
    setPath(state.settings, key, v);
  } else if (el.dataset.payout) {
    const [kind, n, hits] = el.dataset.payout.split('.');
    const v = el.value === '' ? null : Number(el.value);
    if (kind === 'standard') {
      if (v) state.settings.payouts.standard[n] = v;
      else delete state.settings.payouts.standard[n];
    } else {
      const t = (state.settings.payouts.flex[n] ??= {});
      if (v) t[hits] = v;
      else delete t[hits];
      if (!Object.keys(t).length) delete state.settings.payouts.flex[n];
    }
  } else return;
  save();
  BE = bestBreakEven();
  if (el.dataset.payout) renderSettings();
  renderBoard();
  renderEntry();
}

// ---------- Live fetch ----------

let fetchedEvents = [];

function openFetchDialog() {
  const hasKey = !!state.settings.apiKey;
  $('#fetch-intro').innerHTML = hasKey
    ? 'Pulls Underdog lines and sportsbook odds for the games you choose, then estimates each pick from the no-vig sportsbook consensus. Each game costs Odds API credits (about markets × regions).'
    : '<b>Add your Odds API key in Settings first.</b> The free tier at the-odds-api.com gives 500 credits/month.';
  $('#fetch-events').disabled = !hasKey;
  $('#fetch-events-list').innerHTML = '';
  $('#fetch-markets').innerHTML = '';
  $('#fetch-msg').textContent = '';
  $('#fetch-go').disabled = true;
  $('#fetch-dialog').showModal();
}

async function loadEvents() {
  const sport = $('#fetch-sport').value;
  $('#fetch-msg').textContent = 'Loading games…';
  try {
    const { events, remaining } = await listEvents(state.settings.apiKey, sport);
    const now = Date.now();
    fetchedEvents = events.filter((e) => new Date(e.commence_time).getTime() > now - 3 * 3600e3).slice(0, 40);
    $('#fetch-events-list').innerHTML = fetchedEvents.length
      ? `<h3>Games</h3><div class="checks" style="flex-direction:column;gap:4px;max-height:200px;overflow:auto">${fetchedEvents
          .map((e, i) => `<label><input type="checkbox" value="${i}" ${i < 3 ? 'checked' : ''}/> ${esc(e.away_team)} @ ${esc(e.home_team)} <span class="sub">&nbsp;${new Date(e.commence_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></label>`)
          .join('')}</div>`
      : '<p class="hint">No upcoming games found.</p>';
    const markets = Object.entries(MARKETS[sport]);
    const defaults = sport === 'NBA' ? ['player_points', 'player_rebounds', 'player_assists', 'player_threes'] : ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions'];
    $('#fetch-markets').innerHTML = `<h3>Markets</h3><div class="checks" style="flex-wrap:wrap">${markets
      .map(([k, stat]) => `<label><input type="checkbox" value="${k}" ${defaults.includes(k) ? 'checked' : ''}/> ${esc(M.statInfo(sport, stat).label)}</label>`)
      .join('')}</div>`;
    $('#fetch-go').disabled = !fetchedEvents.length;
    $('#fetch-msg').textContent = remaining != null ? `Credits remaining: ${remaining}` : '';
  } catch (err) {
    $('#fetch-msg').textContent = `Couldn't load games: ${err.message}`;
  }
}

async function fetchProps() {
  const sport = $('#fetch-sport').value;
  const events = $$('#fetch-events-list input:checked').map((i) => fetchedEvents[+i.value]);
  const markets = $$('#fetch-markets input:checked').map((i) => i.value);
  if (!events.length || !markets.length) return ($('#fetch-msg').textContent = 'Pick at least one game and one market.');
  $('#fetch-go').disabled = true;
  let added = 0, updated = 0, remaining = null;
  const opts = { regions: state.settings.regions, markets, sharpBooks: state.settings.sharpBooks };
  try {
    for (const [i, ev] of events.entries()) {
      $('#fetch-msg').textContent = `Fetching ${i + 1}/${events.length}: ${ev.away_team} @ ${ev.home_team}…`;
      const res = await fetchEventPicks(state.settings.apiKey, sport, ev, opts);
      remaining = res.remaining;
      for (const raw of res.picks) {
        const existing = state.picks.find((p) => p.player === raw.player && p.stat === raw.stat && p.sport === raw.sport);
        if (existing) {
          Object.assign(existing, { line: raw.line, overOdds: raw.overOdds, underOdds: raw.underOdds, marketMean: raw.marketMean, marketBooks: raw.marketBooks, game: raw.game, gameId: raw.gameId, startTime: raw.startTime });
          updated++;
        } else {
          state.picks.push({ ...normalizePick(raw), gameId: raw.gameId });
          added++;
        }
      }
    }
    save();
    renderAll();
    $('#fetch-msg').textContent = `Done: ${added} new, ${updated} updated.${remaining != null ? ` Credits remaining: ${remaining}.` : ''}${added + updated === 0 ? ' No Underdog lines found — Underdog may not have posted props yet, or your regions need "us_dfs".' : ''}`;
  } catch (err) {
    $('#fetch-msg').textContent = `Fetch failed: ${err.message}`;
  } finally {
    $('#fetch-go').disabled = false;
  }
}

// ---------- Guide ----------

function renderGuide() {
  const p = state.settings.payouts;
  const rows = Object.entries(p.standard)
    .map(([n, m]) => `<tr><td>${n}-pick standard</td><td class="num">${m}x</td><td class="num">${pct(M.breakEvenStandard(+n, m))}</td></tr>`)
    .concat(Object.entries(p.flex).map(([n, t]) => `<tr><td>${n}-pick flex</td><td class="num">${Object.entries(t).sort((a, b) => b[0] - a[0]).map(([, v]) => v + 'x').join(' / ')}</td><td class="num">${pct(M.breakEvenTiered(+n, t))}</td></tr>`))
    .join('');
  $('#guide-content').innerHTML = `
    <h2>The honest version</h2>
    <p>No site can pick winners for sure. Underdog builds a house edge into its payouts, so picking at random loses money over time.
    What this tool <i>can</i> do is estimate how likely each pick is to hit, tell you which picks clear the bar needed to make money,
    and show the true odds and expected value of an entry before you place it.</p>

    <h2>The bar you have to clear</h2>
    <p>Each entry type needs your picks to win at a certain rate just to break even (assuming the payouts in Settings):</p>
    <table><thead><tr><th>Entry</th><th class="num">Payout</th><th class="num">Break-even per pick</th></tr></thead><tbody>${rows}</tbody></table>
    <p>A coin flip is 50%. To profit you need picks that win more like 56–60%+ of the time.</p>

    <h2>Where the win probabilities come from</h2>
    <ul>
      <li><b>Sportsbook market (most reliable).</b> Sportsbooks like FanDuel, DraftKings and Pinnacle price the same props. Removing their margin ("no-vig") gives a fair probability.
      When Underdog's line is softer than the books (for example Underdog has 64.5 rushing yards but books price the Over at -140 at 64.5), that's an edge. This is how most winning pick'em players find plays.</li>
      <li><b>Your projection.</b> Enter what you expect the player to put up. The model turns it into a probability using typical game-to-game variation for that stat (wider for college football).</li>
      <li><b>Recent game logs.</b> How often the player went over this line recently, pulled toward 50% because 5–10 games is a small sample.</li>
    </ul>
    <p>The weights for each source and a "shrink toward 50%" safety margin are adjustable in Settings.</p>

    <h2>A good workflow</h2>
    <ol>
      <li>Load lines: fetch them live (Odds API key), import a CSV, or add them by hand from the Underdog app.</li>
      <li>For hand-entered picks, look up the same prop at a sportsbook and type in its Over/Under odds. That's the single best input.</li>
      <li>Only consider picks rated <span class="badge strong">Strong</span> or <span class="badge playable">Playable</span>.</li>
      <li>Use <b>Best entries</b> to find the highest-value combination, then check it on the <b>Entry</b> tab.</li>
      <li>Bet the suggested stake or less, save the entry, and mark results so you can see if the estimates are actually working.</li>
    </ol>

    <h2>Things that bite</h2>
    <ul>
      <li><b>Parlays multiply risk.</b> Five 58% picks all hit only about 6.6% of the time. Expect long losing streaks even with an edge.</li>
      <li><b>Correlation.</b> A QB's passing yards and his WR's receiving yards move together. That can help (stack Overs) or hurt. Set same-game correlation in Settings to see the effect.</li>
      <li><b>Lines move.</b> Odds go stale fast, especially near kickoff/tip-off and after injury news. Refresh before you bet.</li>
      <li><b>Payouts change.</b> Underdog adjusts its multipliers. Keep the payout tables in Settings matching the app.</li>
    </ul>

    <h2>Bet responsibly</h2>
    <p>Set a bankroll you can afford to lose and don't chase losses. Underdog is only legal in some states and you must be of legal age.
    If gambling stops being fun, call or text <a href="tel:18004264537">1-800-GAMBLER</a>.</p>`;
}

// ---------- Tabs & wiring ----------

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  try { localStorage.setItem('ue-tab', name); } catch {}
  if (name === 'guide') renderGuide();
}

function renderAll() {
  renderBoard();
  renderEntry();
  renderTracker();
}

function init() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#btn-add').onclick = () => openPickDialog(null);
  $('#btn-demo').onclick = loadSample;
  $('#btn-clear').onclick = () => {
    if (state.picks.length && confirm('Remove all picks from the board? (Tracker entries are kept.)')) {
      state.picks = [];
      save();
      renderAll();
    }
  };
  ['#filter-sport', '#filter-rating', '#filter-search'].forEach((s) => $(s).addEventListener('input', renderBoard));
  $('#board-table').addEventListener('click', onBoardClick);

  // Pick dialog
  const form = $('#pick-form');
  form.sport.addEventListener('change', () => fillStatOptions(form.sport.value, null));
  form.addEventListener('input', updatePickPreview);
  $('#pick-dialog').addEventListener('close', () => {
    if ($('#pick-dialog').returnValue === 'save') savePickFromDialog();
  });

  // Import
  $('#btn-import').onclick = () => {
    $('#import-msg').textContent = '';
    $('#import-dialog').showModal();
  };
  $('#import-go').addEventListener('click', (e) => {
    const { added, errors } = importCsv($('#import-text').value);
    if (errors.length) {
      e.preventDefault();
      $('#import-msg').innerHTML = `Imported ${added}. Skipped ${errors.length}:<br>${errors.slice(0, 6).map(esc).join('<br>')}`;
      $('#import-text').value = '';
    } else toast(`Imported ${added} picks`);
  });

  // Fetch
  $('#btn-fetch').onclick = openFetchDialog;
  $('#fetch-events').onclick = loadEvents;
  $('#fetch-go').onclick = fetchProps;
  $('#fetch-sport').onchange = () => {
    $('#fetch-events-list').innerHTML = '';
    $('#fetch-markets').innerHTML = '';
    $('#fetch-go').disabled = true;
  };

  // Entry
  $('#entry-type').onchange = (e) => {
    state.entry.type = e.target.value;
    save();
    renderEntry();
  };
  $('#entry-stake').oninput = (e) => {
    state.entry.stake = Number(e.target.value);
    save();
    renderEntry();
  };
  $('#entry-picks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action=unselect]');
    if (!b) return;
    state.picks.find((p) => p.id === b.dataset.id).selected = false;
    save();
    renderAll();
  });
  $('#btn-log-entry').onclick = logEntry;
  $('#btn-clear-entry').onclick = () => {
    state.picks.forEach((p) => (p.selected = false));
    save();
    renderAll();
  };

  $('#btn-optimize').onclick = runOptimizer;
  $('#tracker-list').addEventListener('click', onTrackerClick);

  // Settings
  $('#tab-settings').addEventListener('change', onSettingChange);
  $('#btn-reset-payouts').onclick = () => {
    state.settings.payouts = structuredClone(DEFAULT_PAYOUTS);
    save();
    BE = bestBreakEven();
    renderSettings();
    renderAll();
  };
  $('#btn-export').onclick = () => {
    const data = { ...state, settings: { ...state.settings, apiKey: '' } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `underdog-edge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#btn-import-backup').onclick = () => $('#backup-file').click();
  $('#backup-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.picks) || !Array.isArray(data.log)) throw new Error('not a backup file');
      const apiKey = state.settings.apiKey;
      state = { ...state, ...data, settings: { ...structuredClone(DEFAULT_SETTINGS), ...data.settings, apiKey } };
      save();
      BE = bestBreakEven();
      renderSettings();
      renderAll();
      toast('Backup restored');
    } catch (err) {
      toast(`Couldn't import: ${err.message}`);
    }
    e.target.value = '';
  };
  $('#btn-reset-all').onclick = () => {
    if (!confirm('Delete all picks, tracker history and settings?')) return;
    try { localStorage.clear(); } catch {}
    state = loadState();
    BE = bestBreakEven();
    renderSettings();
    renderAll();
  };

  renderSettings();
  renderAll();
  let tab = 'board';
  try { tab = localStorage.getItem('ue-tab') || 'board'; } catch {}
  showTab($(`.tabs button[data-tab="${tab}"]`) ? tab : 'board');
}

init();
