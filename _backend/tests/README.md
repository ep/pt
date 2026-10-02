# Tests for the pt backend and field tools

Five automated test suites live here. They are robot users: each one loads the real
code, clicks through entire sessions in a simulated browser, and checks that
everything behaves. They catch breakage in seconds that manual testing would take
fifteen minutes to find, or miss entirely.

- `qa-worker.mjs` tests `../pt-worker.js` (the Cloudflare Worker) against a fake
  in-memory database. It covers session creation, the session-key gate for closed
  sessions, open sessions (code-only reads and writes under the opened paths, key
  for everything else), seat claiming, path validation, the origin lock, the write
  times a read can carry for presence, and the 7-day retention sweep. No Cloudflare
  account or network needed.
- `qa-pyc.js` tests `../../field-tools/chips/index.html` (Place Your Chips) in a
  simulated browser. It runs a full rehearsal session: studio setup, facilitator
  console, bot players, spotlight discussion, edit windows, the report, plus the
  live-mode wire protocol (session keys, the locked screen, recovery).
- `qa-pair-poll.mjs` tests `../../field-tools/pair-poll/index.html` (Pair Poll) in a
  simulated browser, and runs its live mode against the real worker code with the
  fake database, so the console and the phones talk to the actual gate, open-path
  and prefix-read logic. It covers the five-step studio and its guidance, setup links
  old and new, joining by code, by link and by QR (the lobby QR is decoded with jsQR
  every run), both pacing modes, both reveal cadences, reveal mode and its keyboard,
  the mirrored slides, the diverging bar, re-opening, the recap and report, the frost
  timing, links from sessions started before the code-join release, the bot test
  drive, and the gate screens.
- `qa-room-pulse.mjs` tests `../../field-tools/room-pulse/index.html` (Room Pulse) in a
  simulated browser, against the real worker code with the fake database. It checks the
  math directly (balanced rounds, the Focused run of opposites then winners, wins out of
  times shown, when a tie stays a split, where each dot is placed, headline wording that
  matches the numbers across 2,000 random rooms and never leaves out a side of the map
  holding a fifth of the room, a shift that is named only when the numbers back it,
  facilitator notes that agree with the headline, and a small accuracy study comparing
  Focused with every pair), then runs whole sessions: the four-step studio and its word
  map, joining by link and by code (the lobby QR is decoded with jsQR), presence by the
  worker's clock (asleep phones still count, closed pages leave, a reloaded console never
  over-counts, two tabs are two people), answering with the trail of picks, the room's
  progress figure, the private first look with its notes, the reveal and the shift on the
  console, a projector tab and every phone, reloads, a newcomer at the second pulse, a
  Focused session, an older session, the results download and reading it back, the
  over-time player, ending with undo, the gate screens, and the test drive.
- `qa-report-builder.mjs` tests `../../wbwai201/report-builder/index.html` (the WBWAI 201
  report builder) in a simulated browser. It loads made-up sessions built inside the file
  (no CSV files in the repo), and covers the highlights and their numbers, one organization
  and open enrolment wording, skipped and unanswered activities, section order, shortened
  names, the confidentiality line, the copy for Google Docs, and that the page's security
  lock still matches its script.
- `fake-db.mjs` is the shared fake database the worker, pair-poll and room-pulse suites use.
  It also counts the rows each request touches, so the worker suite can check what a read costs.

## Running them

One-time setup, from the repo root:

    npm install jsdom jsqr

Then, from anywhere in the repo:

    node _backend/tests/qa-worker.mjs
    node _backend/tests/qa-pyc.js
    node _backend/tests/qa-pair-poll.mjs
    node _backend/tests/qa-room-pulse.mjs
    node _backend/tests/qa-report-builder.mjs

Every line prints PASS or FAIL, and the process exits nonzero on any failure.

## The rule

Change the worker or any tool, run all suites, publish only on green. GitHub Actions enforces this: every push runs the suites, and a worker deploy happens only if they pass. Running them locally first just saves you a round trip.
If you add behavior, add a check for it. If a suite fails and you do not
understand why, the suite is right and the change is wrong until proven
otherwise.
