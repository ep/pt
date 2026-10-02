# KickstartChange Report Builder

Turns the CSV export from a KickstartChange session into a report you can save as a PDF, copy into a Google Doc, or copy into an AI tool for a deeper read.

Live at: https://ep.github.io/pt/kc/report-builder/

## What it makes
- Each row in the CSV is a team. A team with no answers in any activity stays out of every count.
- A cover, then a highlights page: one sentence per part of the workshop, with the key numbers ringed. Each number counts what the report shows further down.
- One chapter per team, always: the team, its change, its Hallway Huddle, then everything else in the order of the LABELS block. In the PDF each team starts on a new page.
- The change: one change for everyone puts it on the cover; a different change per team puts each team's change under its name. The page picks the right one from the file, and you can switch.
- A skipped activity isn't in the CSV, so it has no section and no sentence.
- Copy for AI copies a prompt plus every team's answers, so anyone with the report can get themes, barriers and next steps from their own AI tool. It leaves out the organization's name and the date.

## Data safety
- The CSV is read by the browser on the user's computer. Nothing is uploaded.
- A Content-Security-Policy line at the top of index.html blocks every outgoing request, so the page cannot send data anywhere even if someone tries to add a script.
- Do not add the Microsoft Clarity snippet (or any analytics) to this page. It records what is on screen.
- Never commit a CSV or a generated report to this repo, real or test. Mock CSVs live in Drive.

## Editing
- Headlines, list names, the highlight sentences, the AI prompt, the confidentiality line and the order of sections live in the LABELS block near the end of index.html (plain JSON). Safe to edit.
- The main script is locked by a hash in the Content-Security-Policy. If the script changes, the hash must be updated or the page stops working. Rebuild it with Claude rather than editing by hand.

## Tests
`_backend/tests/qa-kc-report-builder.mjs` runs on every push. It also checks that the security lock still matches the script.
