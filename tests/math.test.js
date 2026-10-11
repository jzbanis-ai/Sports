import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/math.js';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('american odds <-> probability', () => {
  close(M.americanToProb(-110), 0.5238);
  close(M.americanToProb(150), 0.4);
  assert.equal(M.americanToProb(50), null);
  assert.equal(M.probToAmerican(0.6), -150);
  assert.equal(M.probToAmerican(0.4), 150);
});

test('devig removes the margin', () => {
  close(M.devig(-110, -110), 0.5);
  close(M.devig(-130, 110), 0.5652 / (0.5652 + 0.4762), 1e-3);
});

test('normal and poisson cdfs', () => {
  close(M.normalCdf(0), 0.5);
  close(M.normalCdf(1.96), 0.975);
  close(M.poissonCdf(0, 1), Math.exp(-1));
  close(M.poissonCdf(2, 1.5), 0.8088);
});

test('projection equal to a .5 line is a coin flip for normal stats', () => {
  close(M.overProbNoPush('NBA', 'points', 24.5, 24.5), 0.5);
  close(M.overProbNoPush('NFL', 'pass_yds', 249.5, 249.5), 0.5);
  assert.ok(M.overProbNoPush('NFL', 'pass_yds', 275, 249.5) > 0.6);
});

test('integer lines have pushes and all outcomes sum to 1', () => {
  const o = M.outcomeProbs('NFL', 'receptions', 5, 5);
  assert.ok(o.push > 0.1);
  close(o.over + o.under + o.push, 1, 1e-9);
  const q = M.outcomeProbs('NBA', 'threes', 2.4, 2);
  close(q.over + q.under + q.push, 1, 1e-9);
});

test('impliedMean inverts overProbNoPush', () => {
  for (const [sport, stat, line] of [['NFL', 'rush_yds', 64.5], ['NBA', 'threes', 2.5], ['CFB', 'pass_tds', 1.5]]) {
    const mu = M.impliedMean(sport, stat, line, 0.58);
    close(M.overProbNoPush(sport, stat, mu, line), 0.58, 1e-4);
  }
});

test('history shrinks toward 50%', () => {
  const h = M.historyOverProb([30, 28, 31, 22, 27], 24.5);
  assert.equal(h.hits, 4);
  close(h.p, 6 / 9);
});

test('estimatePick blends sources and applies shrink', () => {
  const est = M.estimatePick(
    { sport: 'NBA', stat: 'points', line: 24.5, overOdds: -140, underOdds: 115 },
    { market: 1, model: 0, history: 0 },
    0
  );
  close(est.pOver, M.devig(-140, 115));
  const shrunk = M.estimatePick(
    { sport: 'NBA', stat: 'points', line: 24.5, overOdds: -140, underOdds: 115 },
    { market: 1, model: 0, history: 0 },
    0.5
  );
  close(shrunk.pOver, 0.5 + (est.pOver - 0.5) / 2);
  assert.equal(M.estimatePick({ sport: 'NBA', stat: 'points', line: 24.5 }, { market: 1, model: 1, history: 1 }), null);
});

test('hit distribution sums to 1 and matches binomial', () => {
  const d = M.hitDistribution([0.5, 0.5, 0.5]);
  assert.deepEqual(d.map((x) => +x.toFixed(4)), [0.125, 0.375, 0.375, 0.125]);
});

test('correlated distribution reduces to independent at rho=0 and fattens tails at rho>0', () => {
  const p = [0.55, 0.55, 0.55];
  assert.deepEqual(M.hitDistributionCorrelated(p, [1, 1, 1], 0), M.hitDistribution(p));
  const corr = M.hitDistributionCorrelated(p, [1, 1, 1], 0.4);
  assert.ok(corr[3] > M.hitDistribution(p)[3]);
  close(corr.reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('entry EV and break-even', () => {
  const d = M.hitDistribution([0.5, 0.5]);
  close(M.entryStats(d, { 2: 3 }).ev, -0.25);
  close(M.breakEvenStandard(2, 3), 0.57735);
  close(M.breakEvenStandard(5, 20), 0.5493);
  const tiers = { 3: 3, 2: 1 };
  const be = M.breakEvenTiered(3, tiers);
  close(M.entryStats(M.hitDistribution([be, be, be]), tiers).ev, 0, 1e-6);
});

test('kelly is zero for -EV and positive for +EV', () => {
  assert.equal(M.kellyFraction(M.hitDistribution([0.5, 0.5]), { 2: 3 }), 0);
  // Single even-money-style check: p=0.6 at 2x -> Kelly = 2p-1 = 0.2
  close(M.kellyFraction([0.4, 0.6], { 1: 2 }), 0.2, 1e-3);
});

test('combinations', () => {
  assert.equal(M.combinations(5, 2).length, 10);
  assert.equal(M.combinations(6, 6).length, 1);
});
