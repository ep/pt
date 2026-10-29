# Tests for the pt backend, field tools and shared kits

Ten automated test suites live here. They are robot users: each one loads the real
code, clicks through entire sessions in a simulated browser, and checks that
everything behaves. They catch breakage in seconds that manual testing would take
fifteen minutes to find, or miss entirely.

- `qa-worker.mjs` tests `../pt-worker.js` (the Cloudflare Worker) against a fake
  in-memory database. It covers session creation, the session-key gate for closed
  sessions, open sessions (code-only reads and writes under the opened paths, key
  for everything else), seat claiming, path validation, the origin lock, the write
  times a read can carry for presence, the feedback routes (tester codes, comments
  testers can change only for themselves, the team key, reviews with Ignore and still
  open, caps, context that is trimmed rather than refused, edits that keep the stored
  context, newer words that a late request can't undo, delete markers, counts that
  can't double, and bodies checked by size however they arrive), and the
  retention sweeps. No Cloudflare
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
- `qa-kc-report-builder.mjs` tests `../../kc/report-builder/index.html` (the KickstartChange
  report builder) the same way, with made-up teams built inside the file. It covers one
  chapter per team (team, change, Hallway Huddle, then the rest), one change for everyone
  or one per team, the highlights and their numbers, skipped activities, columns its LABELS
  block hides, the copies for
  Google Docs and for AI, and that the page's security lock still matches its script.
- `qa-ai-impact-ladder.mjs` tests `../../field-tools/ai-impact-ladder/index.html` (AI Impact
  Ladder) in a simulated browser. It walks the whole conversation: the read on usage and
  results, the three-pick cap on leadership priorities, the ladder intro and each rung (status,
  split views, how you know, what's helping), the focus suggestion against the panel's
  scenarios and the "Worth a check" line, which measure sections open and what to start with,
  notes (left out of the report unless ticked), the plan fields, the text, report and CSV
  (escaping everything typed; downloads only on the hosted page), picking up after a reload,
  a browser that blocks storage, no analytics or brand names, and one primary button per screen.
- `qa-reimagination-lab.mjs` tests `../../field-tools/reimagination-lab/index.html` (the
  Reimagination Lab) in a simulated browser. It walks a whole team session, in a room and
  then on a call: the plan of six steps, the rail that fills with the group's own words (and
  shows only the names of steps still ahead), timers that take 30 seconds off or on and end
  once you move past their screen, the wall of eye-rollers, the vote revealed through Next
  with ties waiting for a pick, the why chain (each line unlocks the next) and picking which
  line is the real purpose, the three ways to draw it, the strip of frames the steps become
  (typed in between where the workflow starts and ends, moved, removed with undo), one face
  stamped on each frame, up to three steps picked to question as necessary or inherited, the
  captioned story player (silent when the sound is off, captions and sound in the player
  itself, and carrying on in captions when the voice can't play), the four moves (select a
  step and pick a move from its menu: cut, shrink or amplify with a line on how, a new step
  after it, or leave it as it was, by mouse or keyboard), the new workflow in Share it, the
  workshops with one way to contact ExperiencePoint, the finish that plays today's workflow
  turning into the new one before the card (with motion on, and at once with reduced
  motion), and the first test. It walks a whole solo session too (no team-only screens, and
  the steps typed straight in), one screen at a time with at most one filled button. It
  checks that typed text never runs as code, that everything the group types (and every
  line that quotes it) is marked private for the feedback kit, two tabs open on one
  session, the Light and Dark setting, print, the outcome image, Email this with the real
  send kit, picking up after a reload (including sessions saved by earlier versions and
  screens that have since gone, and steps edited after the moves keeping their changes),
  clear with undo, that the page stays well under 1 MB with the voice in its own file
  beside it (`story.mp3`), and the hooks the feedback board uses: its parts (every screen
  in exactly one) and opening any screen with made-up content.
- `qa-kit.mjs` tests the shared kits in `../../assets/kit/` in a simulated browser, against
  the real worker code with the fake database: the feedback kit (`feedback.js`, and the
  comment bar it loads only in feedback mode) and the Email this kit (`send.js`). It covers
  a normal visit (nothing else loads, nothing is recorded), the tester link and its code,
  remembering feedback mode per tab and turning it off, the first tip, pointing (the
  comment cursor, the outline, a click on a part or the whole screen, no drawing, moving a
  comment to another part while writing), posting straight to the worker with the context
  every comment carries (keys and codes removed, typed words never recorded, the file's Git
  fingerprint, the exact place of the part), the posted moment, pins that follow their
  part, editing and deleting your own comments, words that are never lost (kept as they
  are typed, back after a reload, Cancel that asks first, a warning before leaving), waiting
  offline, sending on the way out and posting later, a comment an older kit couldn't post,
  one request per comment at a time, edits after a reload, two tabs and two tools, old
  draft slots, a delete while posting, a full browser storage,
  clearing your own list with a three-second hold (and every way a hold stops early)
  while the board keeps every comment, Done, a bad or retired link, phones, a
  file opened from a computer, the replay the board uses (the tool's sections, and finding
  each comment's part in the rebuilt screen: exact places, older comments by path and
  words, made-up content, parts that are gone or still drawing in, the tester's own scroll, undone
  for the next comment), keys that never
  reach the tool behind the bar, the Email this links and share sheet, and that the kit
  files are plain ASCII, never write HTML from strings and talk only to the pt worker.
- `qa-feedback-board.mjs` tests `../../feedback/index.html` (the feedback board) in a
  simulated browser, against the real worker code with the fake database and a fake GitHub
  history. It covers signing in with the team key, the overview grouped by the tool's own
  parts (read from the tool through a hidden frame), one comment at a time with Previous,
  Next and the arrow keys, the cards, the rebuilt screen (sandboxed, told which screen to
  open and which parts to find, the right version of the code) and its boxes (around the part
  where the rebuilt screen found it, older hand-drawn boxes moved onto their part, the spot
  the tester pointed at when the part is gone, none for the whole screen), new comments
  arriving on their own, refreshes that never disturb the reviewer, a tester-made address
  that can't reach the frame, Must, Should, Could and Ignore with the number keys, team notes and
  removing them, earlier versions with Then and Now and still open, reviews saved by the
  first board, Copy for AI (what goes in, in what order, what is left out, no names), the
  tester link and a new code, deleting, small screens, more than one tool, escaping, no
  dropdowns, and that the team key never travels in an address.
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
    node _backend/tests/qa-kc-report-builder.mjs
    node _backend/tests/qa-ai-impact-ladder.mjs
    node _backend/tests/qa-kit.mjs
    node _backend/tests/qa-feedback-board.mjs
    node _backend/tests/qa-reimagination-lab.mjs

Every line prints PASS or FAIL, and the process exits nonzero on any failure.

## The rule

Change the worker or any tool, run all suites, publish only on green. GitHub Actions enforces this: every push runs the suites, and a worker deploy happens only if they pass. Running them locally first just saves you a round trip.
If you add behavior, add a check for it. If a suite fails and you do not
understand why, the suite is right and the change is wrong until proven
otherwise.
