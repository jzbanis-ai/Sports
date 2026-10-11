// Optional live data from The Odds API (https://the-odds-api.com). Requires the user's own key.
// It lists Underdog lines (bookmaker "underdog", region "us_dfs") alongside sportsbook prices,
// so we can compare each Underdog line to a no-vig sportsbook consensus.

import { devig, impliedMean, statInfo } from './math.js';

const BASE = 'https://api.the-odds-api.com/v4';

export const SPORT_KEYS = {
  NFL: 'americanfootball_nfl',
  CFB: 'americanfootball_ncaaf',
  NBA: 'basketball_nba',
};

// Odds API market key -> our stat key
const FOOTBALL_MARKETS = {
  player_pass_yds: 'pass_yds',
  player_pass_tds: 'pass_tds',
  player_pass_attempts: 'pass_att',
  player_pass_completions: 'pass_comp',
  player_pass_interceptions: 'pass_int',
  player_rush_yds: 'rush_yds',
  player_rush_attempts: 'rush_att',
  player_receptions: 'receptions',
  player_reception_yds: 'rec_yds',
  player_rush_reception_yds: 'rush_rec_yds',
  player_pass_rush_yds: 'pass_rush_yds',
};

const BASKETBALL_MARKETS = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes',
  player_points_rebounds_assists: 'pra',
  player_points_rebounds: 'pts_reb',
  player_points_assists: 'pts_ast',
  player_rebounds_assists: 'reb_ast',
  player_steals: 'steals',
  player_blocks: 'blocks',
  player_blocks_steals: 'blk_stl',
  player_turnovers: 'turnovers',
};

export const MARKETS = { NFL: FOOTBALL_MARKETS, CFB: FOOTBALL_MARKETS, NBA: BASKETBALL_MARKETS };

async function getJson(url) {
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) msg += ` — ${body.message}`;
    } catch {}
    throw new Error(msg);
  }
  return { data: await res.json(), remaining };
}

export async function listEvents(apiKey, sport) {
  const url = `${BASE}/sports/${SPORT_KEYS[sport]}/events?apiKey=${encodeURIComponent(apiKey)}`;
  const { data, remaining } = await getJson(url);
  return { events: data, remaining };
}

/**
 * Fetch props for one event and turn them into picks.
 * opts: { regions: 'us,us_dfs', markets: [odds api market keys], sharpBooks: ['pinnacle', ...] }
 * Each returned pick has a consensus marketMean derived from every non-DFS book that quotes
 * both sides — books can hang different lines, so we compare implied means, not raw prices.
 */
export async function fetchEventPicks(apiKey, sport, event, opts) {
  const params = new URLSearchParams({
    apiKey,
    regions: opts.regions,
    markets: opts.markets.join(','),
    oddsFormat: 'american',
  });
  const url = `${BASE}/sports/${SPORT_KEYS[sport]}/events/${event.id}/odds?${params}`;
  const { data, remaining } = await getJson(url);
  return { picks: parseEventOdds(sport, data, opts.sharpBooks), remaining };
}

export function parseEventOdds(sport, data, sharpBooks = []) {
  const marketMap = MARKETS[sport];
  const game = `${data.away_team} @ ${data.home_team}`;
  const underdog = new Map(); // key -> { player, stat, line }
  const books = new Map(); // key -> [{ book, line, over, under }]

  for (const bm of data.bookmakers ?? []) {
    for (const market of bm.markets ?? []) {
      const stat = marketMap[market.key];
      if (!stat || !statInfo(sport, stat)) continue;
      // Group Over/Under outcomes by player + line.
      const byPlayer = new Map();
      for (const o of market.outcomes ?? []) {
        const player = o.description;
        if (!player || o.point == null) continue;
        const k = `${player}|${o.point}`;
        const entry = byPlayer.get(k) ?? { player, line: o.point };
        if (o.name === 'Over') entry.over = o.price;
        if (o.name === 'Under') entry.under = o.price;
        byPlayer.set(k, entry);
      }
      for (const e of byPlayer.values()) {
        const key = `${e.player}|${stat}`;
        if (bm.key === 'underdog') {
          underdog.set(key, { player: e.player, stat, line: e.line });
        } else if (e.over != null && e.under != null && !DFS_BOOKS.has(bm.key)) {
          const list = books.get(key) ?? [];
          list.push({ book: bm.key, line: e.line, over: e.over, under: e.under });
          books.set(key, list);
        }
      }
    }
  }

  const picks = [];
  for (const [key, ud] of underdog) {
    let quotes = books.get(key) ?? [];
    const sharp = quotes.filter((q) => sharpBooks.includes(q.book));
    if (sharp.length) quotes = sharp;
    const means = [];
    for (const q of quotes) {
      const p = devig(q.over, q.under);
      const mu = p == null ? null : impliedMean(sport, ud.stat, q.line, p);
      if (mu != null) means.push(mu);
    }
    const marketMean = means.length ? means.reduce((a, b) => a + b, 0) / means.length : null;
    // When a single book quotes the exact Underdog line, keep its prices for display.
    const sameLine = quotes.find((q) => q.line === ud.line);
    picks.push({
      sport,
      player: ud.player,
      team: '',
      game,
      gameId: data.id,
      startTime: data.commence_time,
      stat: ud.stat,
      line: ud.line,
      overOdds: sameLine?.over ?? null,
      underOdds: sameLine?.under ?? null,
      marketMean,
      marketBooks: quotes.map((q) => q.book),
      source: 'odds-api',
    });
  }
  return picks;
}

const DFS_BOOKS = new Set(['underdog', 'prizepicks', 'pick6', 'betr_us_dfs', 'dabble_au', 'sleeper']);
