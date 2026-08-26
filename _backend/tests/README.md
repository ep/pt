# Tests for the pt backend and field tools

Two automated test suites live here. They are robot users: each one loads the real
code, clicks through entire sessions in a simulated browser, and checks that
everything behaves. They catch breakage in seconds that manual testing would take
fifteen minutes to find, or miss entirely.

- `qa-worker.mjs` tests `../pt-worker.js` (the Cloudflare Worker) against a fake
  in-memory database. It covers session creation, the magic-link gate, seat
  claiming, path validation, the origin lock, and the 7-day retention sweep.
  No Cloudflare account or network needed.
- `qa-pyc.js` tests `../../field-tools/chips/index.html` (Place Your Chips) in a
  simulated browser. It runs a full rehearsal session: studio setup, facilitator
  console, bot players, spotlight discussion, edit windows, the report, plus the
  live-mode wire protocol (session keys, the locked screen, recovery).

## Running them

One-time setup, from the repo root:

    npm install jsdom

Then, from anywhere in the repo:

    node _backend/tests/qa-worker.mjs
    node _backend/tests/qa-pyc.js

Every line prints PASS or FAIL, and the process exits nonzero on any failure.

## The rule

Change the worker or the chips tool, run both suites, publish only on green.
If you add behavior, add a check for it. If a suite fails and you do not
understand why, the suite is right and the change is wrong until proven
otherwise.
