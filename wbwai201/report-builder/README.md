# WBWAI 201 Report Builder

Turns the CSV export from a WBWAI 201 session into a sponsor-ready report (Save as PDF, or Copy for Google Docs).

Live at: https://ep.github.io/pt/wbwai201/report-builder/

## Data safety
- The CSV is read by the browser on the user's computer. Nothing is uploaded.
- A Content-Security-Policy line at the top of index.html blocks every outgoing request, so the page cannot send data anywhere even if someone tries to add a script.
- Do not add the Microsoft Clarity snippet (or any analytics) to this page. It records what is on screen.
- Never commit a CSV or a generated report to this repo, real or test. Test files live in Drive.

## Editing
- Headlines and list names live in the LABELS block near the end of index.html (plain JSON). Safe to edit.
- The main script is locked by a hash in the Content-Security-Policy. If the script changes, the hash must be updated or the page stops working. Rebuild it with Claude rather than editing by hand.
