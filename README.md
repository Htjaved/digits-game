# Arcade — small two-player table games

A tiny arcade of phone-friendly two-player games, built for killing time at a
restaurant table. Pick a game from the menu, then play across two phones
(room codes) or locally on one.

## Games
- **Digits** — pick a secret 4–6 digit number, trade guesses, get told how
  many digits are correct and how many are in the right place. Supports
  Online/Private lobby (1v1/2v2/3v3), Local pass-and-play, and Vs Bot
  (Easy/Normal/Hard, Hard runs real constraint-satisfaction deduction).
- **Hangman** — both players secretly pick a word and guess letters against
  each other's word at the same time. Separate lives per player (6 each);
  run out and you lose immediately.
- **20 Questions** — both players secretly think of something. Each turn,
  either ask a yes/no question or take a free guess. First correct guess wins.
- **Dots and Boxes** — classic pen-and-paper game. Take turns drawing lines;
  complete a box and you get an extra turn. Most boxes when the grid fills
  wins. Pick a grid size from 3×3 to 6×6 boxes.

## Architecture
- No build step — plain HTML/JS/CSS, ES modules loaded on demand.
- `index.html` — the arcade shell: menu, header, and dynamic `import()` of
  whichever game is selected.
- `shared.css` — shared visual language (cards, buttons, keypad, receipts)
  used by every game so they feel consistent.
- `games/digits.js`, `games/hangman.js`, `games/q20.js`, `games/dab.js` —
  each game is fully self-contained in its own file: its own state, its own
  rendering, its own Supabase calls. None of them import from each other.

## Backend
Supabase project `nihal-budget-tracker-2`.
- Digits uses its own dedicated tables: `ngg_games`, `ngg_players`,
  `ngg_secrets`, `ngg_guesses` — untouched by the newer games.
- Hangman, 20 Questions, and Dots and Boxes share one generic schema:
  `arc_games` (one row per match, with a `game_type` column and flexible
  `config`/`state` JSON), `arc_players` (per-seat info: name, secret, lives),
  and `arc_events` (an append-only log of questions, letter guesses, and line
  moves). Each game's specific rules live in dedicated Postgres functions
  (`hm_*` for Hangman, `q20_*` for 20 Questions, `dab_*` for Dots and Boxes)
  that all read/write this same shared schema — so adding a future game
  doesn't require new tables, just new functions.
- All secrets and scoring logic live server-side in `SECURITY DEFINER`
  functions; the browser never receives an opponent's secret until a game
  finishes.
