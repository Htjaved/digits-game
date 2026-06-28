# Digits — a two-player number-guessing game

A small static web game for two phones. Solo or in teams (1v1 / 2v2 / 3v3), each side picks a secret 4-, 5- or 6-digit number, then players take turns guessing. After each guess you're told how many
digits are correct and how many are in the right place. Built as a single
`index.html` using the Supabase JS client over locked, server-side RPCs (no
secret ever reaches the other phone). No build step.

## How to play
1. One person taps **Start a new game**, picks 4 or 5 digits, shares the code.
2. The other taps **Join with a code**.
3. Both lock in a secret number.
4. Take turns guessing. First to crack the other's number wins.

## Backend
Supabase project `nihal-budget-tracker-2`. Game tables are namespaced `ngg_*`
and are independent of the budget-tracker tables.
