import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventOdds } from '../js/oddsapi.js';
import { overProbNoPush, devig } from '../js/math.js';

const event = {
  id: 'evt1', home_team: 'Philadelphia Eagles', away_team: 'Dallas Cowboys', commence_time: '2026-10-12T17:00:00Z',
  bookmakers: [
    { key: 'underdog', markets: [{ key: 'player_rush_yds', outcomes: [
      { name: 'Over', description: 'Saquon Barkley', point: 84.5 },
      { name: 'Under', description: 'Saquon Barkley', point: 84.5 },
    ] }] },
    { key: 'fanduel', markets: [{ key: 'player_rush_yds', outcomes: [
      { name: 'Over', description: 'Saquon Barkley', point: 89.5, price: -115 },
      { name: 'Under', description: 'Saquon Barkley', point: 89.5, price: -115 },
    ] }] },
    { key: 'draftkings', markets: [{ key: 'player_rush_yds', outcomes: [
      { name: 'Over', description: 'Saquon Barkley', point: 84.5, price: -140 },
      { name: 'Under', description: 'Saquon Barkley', point: 84.5, price: 110 },
    ] }] },
    { key: 'prizepicks', markets: [{ key: 'player_rush_yds', outcomes: [
      { name: 'Over', description: 'Saquon Barkley', point: 80.5, price: -137 },
      { name: 'Under', description: 'Saquon Barkley', point: 80.5, price: -137 },
    ] }] },
  ],
};

test('parses an Underdog line and builds a consensus from sportsbooks only', () => {
  const picks = parseEventOdds('NFL', event, []);
  assert.equal(picks.length, 1);
  const p = picks[0];
  assert.equal(p.player, 'Saquon Barkley');
  assert.equal(p.stat, 'rush_yds');
  assert.equal(p.line, 84.5);
  assert.equal(p.game, 'Dallas Cowboys @ Philadelphia Eagles');
  assert.deepEqual(p.marketBooks.sort(), ['draftkings', 'fanduel']);
  assert.equal(p.overOdds, -140);
  // FanDuel says ~89.5 is the median, DraftKings says 84.5 is a ~56% over -> consensus favors Over at 84.5.
  const pOver = overProbNoPush('NFL', 'rush_yds', p.marketMean, 84.5);
  assert.ok(pOver > 0.5 && pOver < 0.65, `pOver=${pOver}`);
  assert.ok(pOver > 0.5 && devig(-140, 110) > 0.5);
});

test('prefers listed sharp books when present', () => {
  const p = parseEventOdds('NFL', event, ['fanduel'])[0];
  assert.deepEqual(p.marketBooks, ['fanduel']);
  assert.equal(p.overOdds, null);
});
