# Digits — a number-guessing game

A small web game. Pick a secret 4-, 5-, or 6-digit number, then trade guesses
with an opponent. After each guess you learn how many digits are correct and
how many are in the right place.

## Modes
- **Online / Private lobby** — play across two phones using a 4-letter room
  code. Supports 1v1, 2v2, and 3v3 team play. Backed by Supabase; secrets
  never leave the server.
- **Local · pass & play** — two players, one phone. The screen hides between
  turns with a "pass the phone" prompt so no one peeks.
- **Vs Bot** — practice solo. Easy guesses randomly, Normal leans on digits
  it's confirmed are in your number, Hard runs a real constraint-satisfaction
  solver that narrows the candidate pool after every guess.

No build step — everything lives in `index.html`.

## Backend
Supabase project `nihal-budget-tracker-2`. Game tables are namespaced `ngg_*`
and are independent of the budget-tracker tables. Local and Bot modes run
entirely client-side and touch no backend.
