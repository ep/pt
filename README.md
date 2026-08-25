# pt

A product testing space for simple, temporary, client-facing assets and tools, published via GitHub Pages.

There is no homepage at the repo root by design. Each project lives in its own folder and is published at its own URL:

- https://ep.github.io/pt/Logistics/EC/In-Person/ : Support Team's experimental logistics checklist
- https://ep.github.io/pt/agents/ : Create Your First Agent. A companion activity for Work Better with AI 201.
- https://ep.github.io/pt/kc/ : KickstartChange partner enablement hub.
- https://ep.github.io/pt/wbwai201/ : Work Better with AI 201 partner enablement hub.
- https://ep.github.io/pt/ai-champion-charter/ : Interactive field tool to help a sponsor draft an AI champion charter.
- https://ep.github.io/pt/t3/wbwai-curveballroleplay/ : Experimental T3 artefact: WBWAI Curveball Roleplay 
- https://ep.github.io/pt/podium-for-partners/ : Testing Podium's positioning with IP-holder partner prospects.
  - https://ep.github.io/pt/podium-for-partners-ideo/ IDEO version.

## How it works

Pages deploys from the root of `main`. Any folder with an `index.html` is published at `https://ep.github.io/pt/<folder>/`. The empty `.nojekyll` file stops Pages from rendering this README as a root homepage, so `https://ep.github.io/pt/` returns 404 on purpose.

To add a project: create a folder, add an `index.html`, commit. 

Add `<meta name="robots" content="noindex, nofollow">` inside `<head>` to prevent compliant crawlers (Google, Bing, etc.) from indexing the page or following its links. 
