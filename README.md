# pt

A product testing space for simple, temporary, client-facing assets and tools, published via GitHub Pages.

There is no homepage at the repo root by design. Each project lives in its own folder and is published at its own URL:

- https://ep.github.io/pt/agents/ : Create Your First Agent. Companion activity for Work Better with AI 201.
- https://ep.github.io/pt/Logistics/EC/In-Person/ : Support's experimental logistics checklist
- https://ep.github.io/pt/kc/ : KickstartChange partner enablement hub.
- https://ep.github.io/pt/wbwai201/ : Work Better with AI 201 partner enablement hub.
- https://ep.github.io/pt/field-tools/chips/ : Place Your Chips, a live prioritization game (field tool).
- https://ep.github.io/pt/ai-champion-charter/ : Interactive tool to help sponsors draft AI champion charters.
- https://ep.github.io/pt/t3/wbwai-curveballroleplay/ : Experimental T3 artefact: WBWAI Curveball Roleplay 
- https://ep.github.io/pt/podium-for-partners/ : Positioning Podium with IP-holder partner prospects.
  - https://ep.github.io/pt/podium-for-partners-ideo/ IDEO version.

## How it works

Pages deploys from the root of `main`. Any folder with an `index.html` is published at `https://ep.github.io/pt/<folder>/`. The empty `.nojekyll` file stops Pages from rendering this README as a root homepage, so `https://ep.github.io/pt/` returns 404 on purpose.

Folder conventions: interactive field tools (games, diagnostics, workshop tools) live under `field-tools/`, one folder per tool. Other kinds of test tools get their own top-level folders.

To add a project: create a folder, add an `index.html`, commit. 

Add `<meta name="robots" content="noindex, nofollow">` inside `<head>` to prevent compliant crawlers (Google, Bing, etc.) from indexing the page or following its links. 

## Two things to know before committing anything

1. Everything in this repo is public twice: browsable here on GitHub, and served as a live page at the Pages URL. That includes this README and the `_backend` folder. Never commit client-sensitive content, internal strategy, or anything you would not put on the open internet.
2. Never commit secrets. No API keys, no passwords, not even briefly to test something. The moment a secret touches a public repo, treat it as leaked. Secrets live in the Cloudflare dashboard only.

## The backend

Static pages cannot remember anything or keep a secret, so tools that need shared live state (like Place Your Chips) talk to a small server we run on Cloudflare: a Worker named `pt` with a D1 database, also named `pt`. One backend serves every tool in this repo; each tool identifies itself with a short id, so their data never mixes.

- The source of truth for the deployed code is `_backend/pt-worker.js` in this repo. Deploying a change means pasting that file into the Cloudflare dashboard (Workers & Pages, `pt`, Edit code, Deploy). If you change one, change the other.
- Some tools are gated: their sessions require a key that is generated when a facilitator starts a session and rides inside the join link. Participants just click the link. The list of gated tools is the `GATED_TOOLS_DEFAULT` line near the top of the worker file. Tools handling anything sensitive belong on that list.
- Session data is temporary by design. Ending a session deletes it immediately, and a daily sweep deletes anything untouched for 7 days. Nothing in the backend is an archive; if a session produced something worth keeping, download the report.

## Adding a tool that needs the backend

Pick a short id for the tool (letters, numbers, hyphens, like `pyc`), point the tool at the worker URL, and send that id with every request. If the tool will hold sensitive content, add its id to `GATED_TOOLS_DEFAULT` in `_backend/pt-worker.js` and redeploy. If you are unsure whether a tool needs the backend at all, it probably does not: pages that only display things need nothing.

