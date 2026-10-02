# WBWAI 201 Report Builder

Turns the CSV export from a WBWAI 201 session into a sponsor-ready report (Save as PDF, or Copy for Google Docs).

Live at: https://ep.github.io/pt/wbwai201/report-builder/

## What it makes
- A cover with a confidentiality line, then a highlights page: one sentence per activity, with the key numbers ringed. Each number counts the answers shown further down, so every figure can be checked in the report.
- The wording changes with who took part: one organization (the sentences use its name) or open enrolment (the sentences speak about the participants' own organizations).
- One section per activity, in the order of the LABELS block (the AI curve first). A skipped activity simply isn't in the CSV, so it has no section and no sentence. An activity nobody answered starts unticked.
- A row with no answers in any activity is treated as someone who registered but took no part, and stays out of every count.

## Data safety
- The CSV is read by the browser on the user's computer. Nothing is uploaded.
- A Content-Security-Policy line at the top of index.html blocks every outgoing request, so the page cannot send data anywhere even if someone tries to add a script.
- Do not add the Microsoft Clarity snippet (or any analytics) to this page. It records what is on screen.
- Never commit a CSV or a generated report to this repo, real or test. Mock CSVs live in Drive.

## Editing
- Headlines, list names, the highlight sentences, the confidentiality line and the order of sections live in the LABELS block near the end of index.html (plain JSON). Safe to edit; the comment above the block explains the highlight placeholders.
- The main script is locked by a hash in the Content-Security-Policy. If the script changes, the hash must be updated or the page stops working. Rebuild it with Claude rather than editing by hand.

## Tests
`_backend/tests/qa-report-builder.mjs` runs on every push. It also checks that the security lock still matches the script.

## Printing
- Built to print the same in Chrome, Safari and Firefox: answers never split across pages and headings stay with what follows them.
- The cover page prints with no page margin (it pads itself), which keeps Chrome from adding its own date, title and file address to the pages.
- Page numbers show in Chrome and recent Safari. Firefox doesn't support them.
- Firefox can still add the page title and address to each page. To leave them off, open More settings in its print dialog and untick Print headers and footers.

## Names
Anonymous is the default, and the right choice for almost every report: sponsors share these further than anyone expects. Show names only when the sponsor asked for it and everyone in the room knew.
