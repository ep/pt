/*
  pt: the shared backend for every tool in the pt repo.
  One Cloudflare Worker, one D1 database (bound as "DB"). Tools identify
  themselves with a short id, so their sessions never mix.

  This file lives in the repo at pt/_backend/pt-worker.js. GitHub Actions deploys
  it automatically (tests first) whenever _backend/ changes on main; the worker's
  name, database binding, and cron trigger are declared in _backend/wrangler.toml.
  Never edit this worker in the Cloudflare dashboard: the next push overwrites it.
  It contains no secrets and never should. Secrets (future API keys) live in the
  worker's Settings on Cloudflare, or in GitHub Actions secrets, never in a file.

  ONE-TIME DATABASE SETUP (paste into the D1 console):
  CREATE TABLE kv (room TEXT, path TEXT, value TEXT, updated INTEGER, PRIMARY KEY (room, path));

  ENDPOINTS
    GET  /api/health                              -> {ok, gatedTools}
    GET  /api/state?tool=pyc&code=ABCD            -> the whole session as nested JSON
         ...&prefix=pub                        -> only the rows under one prefix (slim read for big rooms)
    POST /api/create {tool, code, sk, open?}      -> start a session; registers its session key
                                                    open: optional list of path prefixes participants
                                                    may write with the code alone (see KEYS)
    POST /api/set    {tool, code, path, value}    -> write one value
    POST /api/claim  {tool, code, path, value}    -> atomic seat claim, {ok:true|false}
    POST /api/clear  {tool, code}                 -> delete the session

  KEYS (gated tools only; see GATED_TOOLS_DEFAULT below)
    Every session has one key, chosen by the tool at session start and sent as
    X-Session-Key. Two kinds of session exist:
    - Closed session (create without "open", the chips model): every request needs
      the key. The key rides inside the join link, so participants click and never
      type. Anyone with the link can do anything in the session.
    - Open session (create with "open", the Pair Poll model): anyone who knows the
      four-letter code can read the session and write under the open prefixes
      (Pair Poll opens "roster" and "ballot"). Everything else, including clear,
      needs the key, which only the facilitator holds. Participants never carry the
      key at all. A wrong key is refused on every request, so a tool can verify a
      key with one read.
    A code is easy to guess by machine (about 280,000 four-letter codes), so a tool
    only opens paths whose contents are harmless if a stranger reads or adds to
    them: anonymous ballots, yes; notes about colleagues, no.

  CONFIGURATION lives in the constants below and in wrangler.toml. Dashboard
  variables GATED_TOOLS and ALLOW_ORIGIN override the constants if ever set, but
  none are set; the account's variables page proved unreliable.

  RETENTION
    The cron trigger in wrangler.toml ("0 4 * * *", daily at 04:00 UTC) runs the
    scheduled() handler below, which deletes any session untouched for 7 days.
    Discussion notes should not outlive their usefulness.

  LATER, WHEN A PROTOTYPE NEEDS IT
    AI proxy: add a secret ANTHROPIC_API_KEY, then uncomment the /api/ai block.
      It only answers requests carrying a valid session key for a gated tool,
      so only people inside a real session can spend the budget.
    Collecting responses (forms, polls, waitlists): add a /api/submit route
      writing append-only rows, keyed the same way (tool + a collection name).
*/

var RETENTION_DAYS = 7;

/* Which tools require a session key. Edit this list and commit to change it.
   A GATED_TOOLS variable in the dashboard, if you ever set one, overrides this. */
var GATED_TOOLS_DEFAULT = 'pyc,pair-poll';

/* Which origins may call this worker. Edit and redeploy to change it.
   An ALLOW_ORIGIN variable in the dashboard, if you ever set one, overrides this.
   Requests with no Origin header (health checks, curl) always pass. */
var ALLOW_ORIGIN_DEFAULT = 'https://ep.github.io';

export default {
  async fetch(request, env) {
    var url = new URL(request.url);

    /* ---- origins ---- */
    var reqOrigin = request.headers.get('Origin') || '';
    var allowList = (env.ALLOW_ORIGIN || ALLOW_ORIGIN_DEFAULT).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var allowOrigin = '*';
    if (allowList.length) {
      allowOrigin = allowList.indexOf(reqOrigin) > -1 ? reqOrigin : allowList[0];
    }
    var cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-Key',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    function json(obj, status) {
      return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    var gatedTools = (env.GATED_TOOLS || GATED_TOOLS_DEFAULT).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

    if (url.pathname === '/api/health') return json({ ok: true, gatedTools: gatedTools });

    if (allowList.length && reqOrigin && allowList.indexOf(reqOrigin) === -1) {
      return json({ error: 'origin not allowed' }, 403);
    }

    function parseTool(tool) {
      var t = (tool || '').toLowerCase();
      return /^[a-z0-9-]{1,12}$/.test(t) ? t : null;
    }
    function roomOf(tool, code) {
      var c = (code || '').toUpperCase();
      if (!/^[A-Z]{4,8}$/.test(c)) return null;
      return tool + ':' + c;
    }
    /* The two internal rows of a session: _sk (the key) and _open (the prefixes
       participants may write without it). Read together in one query. */
    async function internals(room) {
      var rs = await env.DB.prepare('SELECT path, value FROM kv WHERE room = ? AND (path = ? OR path = ?)').bind(room, '_sk', '_open').all();
      var out = { sk: null, open: null, exists: rs.results.length > 0 };
      for (var i = 0; i < rs.results.length; i++) {
        if (rs.results[i].path === '_sk') out.sk = JSON.parse(rs.results[i].value);
        if (rs.results[i].path === '_open') out.open = JSON.parse(rs.results[i].value);
      }
      return out;
    }
    /* Membership for gated tools. Returns 'host' (key matches), 'guest' (no key,
       open session), or null (refuse). A wrong key is always refused. */
    function member(sk, open, given) {
      if (!sk) return open ? 'guest' : null;
      if (given) return given === sk ? 'host' : null;
      return open ? 'guest' : null;
    }
    function underOpen(open, path) {
      if (!open) return false;
      var seg = String(path || '').split('/')[0];
      return open.indexOf(seg) > -1;
    }

    try {
      if (url.pathname === '/api/state' && request.method === 'GET') {
        var tool = parseTool(url.searchParams.get('tool'));
        if (!tool) return json({ error: 'bad tool' }, 400);
        var room = roomOf(tool, url.searchParams.get('code'));
        if (!room) return json({ error: 'bad code' }, 400);
        /* Optional slim read: ?prefix=pub returns only the rows under that prefix.
           Phones in a big room fetch a couple dozen small rows instead of every
           ballot. The gate is enforced the same way; the internal rows are read
           separately because they are not under the prefix. */
        var prefix = url.searchParams.get('prefix') || '';
        if (prefix && !/^[A-Za-z0-9][A-Za-z0-9_]{0,11}$/.test(prefix)) return json({ error: 'bad prefix' }, 400);
        var rs;
        if (prefix) {
          rs = await env.DB.prepare('SELECT path, value FROM kv WHERE room = ? AND (path = ? OR path LIKE ?)').bind(room, prefix, prefix + '/%').all();
        } else {
          rs = await env.DB.prepare('SELECT path, value FROM kv WHERE room = ?').bind(room).all();
        }
        if (gatedTools.indexOf(tool) > -1) {
          var inn = await internals(room);
          if (!inn.exists && !rs.results.length) return json({ state: null });
          if (!member(inn.sk, inn.open, request.headers.get('X-Session-Key'))) return json({ error: 'locked' }, 401);
        } else if (!rs.results.length) {
          return json({ state: null });
        }
        var state = {};
        for (var r = 0; r < rs.results.length; r++) {
          if (rs.results[r].path.charAt(0) === '_') continue; /* internals never leave the notebook */
          var parts = rs.results[r].path.split('/');
          var node = state;
          for (var i = 0; i < parts.length - 1; i++) {
            node[parts[i]] = node[parts[i]] || {};
            node = node[parts[i]];
          }
          node[parts[parts.length - 1]] = JSON.parse(rs.results[r].value);
        }
        return json({ state: state });
      }

      if (request.method === 'POST') {
        var body = await request.json();
        var ptool = parseTool(body.tool);
        if (!ptool) return json({ error: 'bad tool' }, 400);
        var proom = roomOf(ptool, body.code);
        if (!proom) return json({ error: 'bad code' }, 400);
        var gated = gatedTools.indexOf(ptool) > -1;

        if (url.pathname === '/api/create') {
          var newSk = typeof body.sk === 'string' && /^[A-Za-z0-9]{8,32}$/.test(body.sk) ? body.sk : null;
          if (gated && !newSk) return json({ error: 'bad key' }, 400);
          var open = null;
          if (body.open !== undefined) {
            if (!Array.isArray(body.open) || !body.open.length || body.open.length > 4) return json({ error: 'bad open' }, 400);
            for (var o = 0; o < body.open.length; o++) {
              if (typeof body.open[o] !== 'string' || !/^[a-z0-9]{1,12}$/.test(body.open[o])) return json({ error: 'bad open' }, 400);
            }
            open = body.open;
          }
          var cres = await env.DB.prepare(
            'INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ' +
            'ON CONFLICT(room, path) DO NOTHING'
          ).bind(proom, '_sk', JSON.stringify(newSk || true), Date.now()).run();
          if (cres.meta.changes > 0 && open) {
            await env.DB.prepare('INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ON CONFLICT(room, path) DO NOTHING')
              .bind(proom, '_open', JSON.stringify(open), Date.now()).run();
          }
          return json({ ok: cres.meta.changes > 0 });
        }

        /* everything below touches an existing session; gated tools must prove membership */
        var role = 'host';
        if (gated) {
          var have = await internals(proom);
          if (!have.exists) return json({ error: 'locked' }, 401);
          role = member(have.sk, have.open, request.headers.get('X-Session-Key'));
          if (!role) return json({ error: 'locked' }, 401);
          if (role === 'guest') {
            if (url.pathname === '/api/clear') return json({ error: 'locked' }, 401);
            if (!underOpen(have.open, body.path)) return json({ error: 'locked' }, 401);
          }
        }

        if (url.pathname === '/api/set') {
          if (typeof body.path !== 'string' || body.path.length > 40 || !/^[A-Za-z0-9_/]+$/.test(body.path) || body.path.charAt(0) === '_') {
            return json({ error: 'bad path' }, 400);
          }
          if (/^(seats|pax)\//.test(body.path)) return json({ error: 'use claim' }, 400);
          var value = JSON.stringify(body.value === undefined ? null : body.value);
          if (value.length > 4000) return json({ error: 'too big' }, 400);
          await env.DB.prepare(
            'INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ' +
            'ON CONFLICT(room, path) DO UPDATE SET value = excluded.value, updated = excluded.updated'
          ).bind(proom, body.path, value, Date.now()).run();
          return json({ ok: true });
        }

        if (url.pathname === '/api/claim') {
          var seatOk = /^seats\/s[1-3]$/.test(body.path || '');
          var paxOk = /^pax\/p([1-9]|1[0-9]|20)$/.test(body.path || '');
          if (!seatOk && !paxOk) return json({ error: 'bad seat' }, 400);
          var claimVal = { claimed: true };
          if (paxOk && body.value && typeof body.value.nick === 'string') {
            var nick = body.value.nick.slice(0, 16).trim();
            if (nick) claimVal = { nick: nick };
          }
          var res = await env.DB.prepare(
            'INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ' +
            'ON CONFLICT(room, path) DO NOTHING'
          ).bind(proom, body.path, JSON.stringify(claimVal), Date.now()).run();
          return json({ ok: res.meta.changes > 0 });
        }

        if (url.pathname === '/api/clear') {
          await env.DB.prepare('DELETE FROM kv WHERE room = ?').bind(proom).run();
          return json({ ok: true });
        }

        /* ---------------------------------------------------------------
           FUTURE: AI PROXY. Add the ANTHROPIC_API_KEY secret first. Kept
           behind the membership check above (host only would be
           `if (role !== 'host') return json({ error: 'locked' }, 401);`),
           so only a live gated session can spend budget.

        if (url.pathname === '/api/ai') {
          var upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 1000,
              messages: [{ role: 'user', content: String(body.prompt || '').slice(0, 4000) }]
            })
          });
          var data = await upstream.json();
          return json(data, upstream.status);
        }
        --------------------------------------------------------------- */
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error' }, 500);
    }
  },

  /* the daily sweep: sessions untouched for RETENTION_DAYS vanish whole */
  async scheduled(event, env, ctx) {
    var cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await env.DB.prepare(
      'DELETE FROM kv WHERE room IN (SELECT room FROM kv GROUP BY room HAVING MAX(updated) < ?)'
    ).bind(cutoff).run();
  }
};
