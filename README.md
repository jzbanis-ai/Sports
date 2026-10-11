# Underdog Edge

A static web app for sizing up Underdog pick'em props (NFL, college football, NBA): it estimates each pick's
win probability, flags which picks clear the break-even bar, and shows the real odds, expected value and a
suggested stake for any entry (parlay).

No build step, no server, no account — open it in a browser. Data is saved in your browser's localStorage.

## Run it

```bash
npm start            # serves the folder at http://localhost:8080
# or: python3 -m http.server 8080
```

(Opening `index.html` directly from disk won't work because browsers block ES modules on `file://`.)

To host it for free, enable **GitHub Pages** on this repo (Settings → Pages → deploy from branch, root folder).

## Features

- **Board** — every prop with its estimated win %, edge over break-even, and a Strong / Playable / Marginal / Pass rating.
  Auto-picks the better side (Higher/Lower), accounting for Underdog's per-pick multipliers.
- **Entry** — chance all picks hit, chance to profit, expected return, break-even rate, payout-by-hits chart,
  fractional-Kelly stake suggestion, and warnings (same game, one team, whole-number lines).
- **Best entries** — searches every 2–6 pick combination from your board and ranks by EV, Kelly growth or profit chance.
- **Tracker** — save entries, mark each pick hit/miss/push, see profit, ROI and whether your probabilities are calibrated.
- **Settings** — bankroll, Kelly fraction, model weights, same-game correlation, editable payout tables, Odds API key, backup/restore.

## Where the probabilities come from

1. **Sportsbook market** (weighted most): Over/Under odds from books like Pinnacle/FanDuel/DraftKings, with the vig removed.
   If a book's line differs from Underdog's, the app backs out the mean the book is pricing and re-evaluates it at Underdog's line.
2. **Your projection**: converted to a probability with a per-stat distribution (normal with stat-specific spread, or Poisson
   for low counts like TDs and threes; 15% more spread for college football).
3. **Recent game logs**: over-rate at this line, shrunk toward 50%.

Weights and an overall "shrink toward 50%" are adjustable.

## Live lines (optional)

With a key from [The Odds API](https://the-odds-api.com), **Fetch live lines** pulls Underdog's lines (region `us_dfs`)
and sportsbook player-prop odds for the games and markets you pick. Each game costs credits (≈ markets × regions).
The key is stored only in your browser.

## Caveats

- Underdog's payouts change and vary by state. Check **Settings → Payout tables** against the app.
- Estimates are only as good as the inputs. No tool guarantees winners — the house edge means most entries lose money.
- Gambling problem? Call 1-800-GAMBLER.

## Development

```bash
npm test   # unit tests for the probability math and Odds API parsing (Node 18+)
```

- `js/math.js` — odds conversion, distributions, pick estimates, entry EV, Kelly (pure, tested)
- `js/oddsapi.js` — The Odds API client and parser
- `js/app.js` — UI
- `js/storage.js` — persistence and default payouts/settings
