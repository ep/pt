/*
  pt: the shared backend for every tool in the pt repo.
  One Cloudflare Worker, one D1 database (bound as "DB"). Tools identify
  themselves with a short id, so their sessions never mix.

  This file lives in the repo at pt/_backend/pt-worker.js. GitHub Actions deploys
  it automatically (tests first) whenever _backend/ changes on main; the worker's
  name, database binding, and cron trigger are declared in _backend/wrangler.toml.
  Never edit this worker in the Cloudflare dashboard: the next push overwrites it.
  It contains no secrets and never should. Secrets (the FEEDBACK_KEY team key, and
  any future API key) live in the worker's Settings on Cloudflare, or in GitHub
  Actions secrets, never in a file.

  ONE-TIME DATABASE SETUP (paste into the D1 console):
  CREATE TABLE kv (room TEXT, path TEXT, value TEXT, updated INTEGER, PRIMARY KEY (room, path));

  ENDPOINTS
    GET  /api/health                              -> {ok, gatedTools, feedback}
    GET  /api/state?tool=pyc&code=ABCD            -> the whole session as nested JSON
         ...&prefix=pub                        -> only the rows under one prefix (slim read for big rooms)
         ...&times=here                        -> also {times, now}: when each row under that prefix was
                                                    last written, and the worker's clock, both in ms, so a
                                                    tool can tell an open page from a closed one (presence)
    POST /api/create {tool, code, sk, open?}      -> start a session; registers its session key
                                                    open: optional list of path prefixes participants
                                                    may write with the code alone (see KEYS)
    POST /api/set    {tool, code, path, value}    -> write one value
    POST /api/claim  {tool, code, path, value}    -> atomic seat claim, {ok:true|false}
    POST /api/clear  {tool, code}                 -> delete the session

  FEEDBACK (the comment kit in assets/kit/ and the board at feedback/)
    GET  /api/fb/check?code=K7QX2M               -> {ok}: is this tester code the current one
    POST /api/fb/post   {tool, code, id, edit, comment} -> add a comment, or change your own
    POST /api/fb/delete {tool, code, id, edit}    -> delete your own comment (the team key deletes any)
    GET  /api/fb/tools                            -> team key: tools with comments, and the tester code
    GET  /api/fb/list?tool=reimagination-lab      -> team key: every comment and the team's review of it
    POST /api/fb/review {tool, id, review}        -> team key: weight (Must, Should, Could or
                                                    Ignore), team notes, and "still open" for
                                                    a comment made on an earlier version
    POST /api/fb/code                             -> team key: a new tester code; old links stop posting
    Testers carry one tester code in their link (?feedback=CODE); it lets them add
    comments and change or delete only their own (each comment has its own edit
    token, kept in the tester's browser). Reading needs the team key, sent as
    X-Team-Key and held as the FEEDBACK_KEY secret in the worker's settings on
    Cloudflare. Comments live in the same kv table, in rooms named fb:<tool>, with
    c/<id> for the tester's words and r/<id> for the team's review. Caps: 2,000
    characters of text, 60 posts per visitor per hour, 3,000 comments per tool.
    A comment is never refused for the size of its context: context that is too
    big is trimmed, and the tester's words are always kept whole. A change that
    leaves out the context or the pointer keeps the ones already stored, and a post
    older than the stored one (comment.updated, the tester's own clock) is ignored,
    so a late or repeated request never undoes a newer edit. A deleted comment
    leaves a marker (d/<id>) for two days, so a post still on its way can't bring
    it back.

  KEYS (gated tools only; see GATED_TOOLS_DEFAULT below)
    Every session has one key, chosen by the tool at session start and sent as
    X-Session-Key. Two kinds of session exist:
    - Closed session (create without "open", the chips model): every request needs
      the key. The key rides inside the join link, so participants click and never
      type. Anyone with the link can do anything in the session.
    - Open session (create with "open", the Pair Poll model): anyone who knows the
      four-letter code can read the session and write under the open prefixes
      (Pair Poll opens "roster" and "ballot"; Room Pulse opens "here" and
      "ballot"). Everything else, including clear, needs the key, which only
      the facilitator holds. Participants never carry the key at all. A wrong
      key is refused on every request, so a tool can verify a key with one read.
    A code is easy to guess by machine (about 280,000 four-letter codes), so a tool
    only opens paths whose contents are harmless if a stranger reads or adds to
    them: anonymous ballots, yes; notes about colleagues, no. Anyone with the code
    can also overwrite rows under the open prefixes, so results you would defend
    forensically call for a closed session too.

  CONFIGURATION lives in the constants below and in wrangler.toml. Dashboard
  variables GATED_TOOLS and ALLOW_ORIGIN override the constants if ever set, but
  none are set; the account's variables page proved unreliable.

  RETENTION
    The cron trigger in wrangler.toml ("0 4 * * *", daily at 04:00 UTC) runs the
    scheduled() handler below, which deletes any session untouched for 7 days.
    Discussion notes should not outlive their usefulness. Feedback rooms (fb:)
    are left out of that sweep: a comment and its review are deleted a year after
    they last changed, and the hourly post counters after two days.

  LATER, WHEN A PROTOTYPE NEEDS IT
    AI proxy: written below but commented out. As written it would also answer
      tools that are not gated, and guests in open sessions. Before turning it
      on, require a gated tool and the session key (role 'host'), then add a
      secret ANTHROPIC_API_KEY and uncomment the /api/ai block.
    Collecting responses (forms, polls, waitlists): add a /api/submit route
      writing append-only rows, keyed the same way (tool + a collection name).
      The feedback routes above are the first of these; copy their caps.
*/

var RETENTION_DAYS = 7;

/* The most rows one session may hold. Stops a scripted code-holder from running
   up the account's write bill (Workers Paid has no daily stop, so usage above the
   plan is charged) or bloating a session; the biggest honest room (400 people,
   ten ballots each) stays well under it. A ROOM_ROWS_MAX dashboard variable
   overrides if ever set. Updating an existing row is always allowed, so a full
   room can still change its answers, and it skips the count entirely. */
var ROOM_ROWS_MAX = 6000;

/* Which tools require a session key. Edit this list and commit to change it.
   A GATED_TOOLS variable in the dashboard, if you ever set one, overrides this. */
var GATED_TOOLS_DEFAULT = 'pyc,pair-poll,room-pulse';

/* Which origins may call this worker. Edit and redeploy to change it.
   An ALLOW_ORIGIN variable in the dashboard, if you ever set one, overrides this.
   Requests with no Origin header (health checks, curl) always pass. */
var ALLOW_ORIGIN_DEFAULT = 'https://ep.github.io';

/* Feedback comments (see FEEDBACK above). */
var FB_ADMIN = 'fb:_admin';
var FB_COMMENTS_MAX = 3000;
var FB_PER_HOUR = 60;
var FB_KEEP_DAYS = 365;

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
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-Key, X-Team-Key',
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

    if (url.pathname === '/api/health') return json({ ok: true, gatedTools: gatedTools, feedback: !!env.FEEDBACK_KEY });

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
      if (url.pathname.indexOf('/api/fb/') === 0) return await feedback(request, env, url, json);

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
        /* Optional write times for one prefix: Room Pulse asks for times=here to count the
           phones that are still open by the worker's clock, not by each device's. */
        var timesOf = url.searchParams.get('times') || '';
        if (timesOf && !/^[A-Za-z0-9][A-Za-z0-9_]{0,11}$/.test(timesOf)) return json({ error: 'bad times' }, 400);
        var rs;
        if (prefix) {
          /* A range on the primary key, so the database reads only these rows. Paths
             hold only letters, digits, _ and /, and '/' is the only one of those that
             sorts below '0', so [prefix, prefix + '0') is exactly the prefix row and
             every row under it. */
          rs = await env.DB.prepare('SELECT path, value, updated FROM kv WHERE room = ? AND path >= ? AND path < ?').bind(room, prefix, prefix + '0').all();
        } else {
          rs = await env.DB.prepare('SELECT path, value, updated FROM kv WHERE room = ?').bind(room).all();
        }
        if (gatedTools.indexOf(tool) > -1) {
          var inn = await internals(room);
          if (!inn.exists && !rs.results.length) return json({ state: null });
          if (!member(inn.sk, inn.open, request.headers.get('X-Session-Key'))) return json({ error: 'locked' }, 401);
        } else if (!rs.results.length) {
          return json({ state: null });
        }
        var state = {}, times = timesOf ? {} : null, under = timesOf + '/';
        for (var r = 0; r < rs.results.length; r++) {
          if (rs.results[r].path.charAt(0) === '_') continue; /* internals never leave the notebook */
          var parts = rs.results[r].path.split('/');
          var node = state;
          for (var i = 0; i < parts.length - 1; i++) {
            node[parts[i]] = node[parts[i]] || {};
            node = node[parts[i]];
          }
          node[parts[parts.length - 1]] = JSON.parse(rs.results[r].value);
          if (times && rs.results[r].path.indexOf(under) === 0) times[rs.results[r].path.slice(under.length)] = rs.results[r].updated;
        }
        return json(times ? { state: state, times: times, now: Date.now() } : { state: state });
      }

      if (request.method === 'POST') {
        /* the largest honest body is an AI prompt of 4,000 characters; refuse anything outsized before parsing */
        var clen = parseInt(request.headers.get('content-length') || '0', 10);
        if (clen > 16384) return json({ error: 'too big' }, 413);
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
          /* Updates are most writes (heartbeats, changed answers) and can never grow
             the room, so they read one row. Only a new row pays for the count. */
          var existing = await env.DB.prepare('SELECT 1 AS x FROM kv WHERE room = ? AND path = ?').bind(proom, body.path).first();
          if (!existing) {
            var cap = parseInt(env.ROOM_ROWS_MAX || '', 10) || ROOM_ROWS_MAX;
            var cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM kv WHERE room = ?').bind(proom).first();
            if (cnt && cnt.c >= cap) return json({ error: 'room full' }, 409);
          }
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
           FUTURE: AI PROXY. Not safe to turn on as written: the membership
           check above runs only for gated tools, and it lets open-session
           guests through. First add
           `if (!gated || role !== 'host') return json({ error: 'locked' }, 401);`
           at the top of the block, then the ANTHROPIC_API_KEY secret.

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

  /* the daily sweep: sessions untouched for RETENTION_DAYS vanish whole; feedback keeps its own clock */
  async scheduled(event, env, ctx) {
    var day = 24 * 60 * 60 * 1000, now = Date.now();
    await env.DB.prepare(
      'DELETE FROM kv WHERE room IN (SELECT room FROM kv WHERE (room < ? OR room >= ?) GROUP BY room HAVING MAX(updated) < ?)'
    ).bind('fb:', 'fb;', now - RETENTION_DAYS * day).run();
    var ranged = 'DELETE FROM kv WHERE room >= ? AND room < ? AND path >= ? AND path < ? AND updated < ?';
    await env.DB.prepare(ranged).bind('fb:', 'fb;', 'c/', 'c0', now - FB_KEEP_DAYS * day).run();
    await env.DB.prepare(ranged).bind('fb:', 'fb;', 'r/', 'r0', now - FB_KEEP_DAYS * day).run();
    await env.DB.prepare(ranged).bind(FB_ADMIN, FB_ADMIN + '0', 'rl/', 'rl0', now - 2 * day).run();
    await env.DB.prepare(ranged).bind('fb:', 'fb;', 'd/', 'd0', now - 2 * day).run();
  }
};

/* ---------- FEEDBACK: comments from testers, reviewed by the team ---------- */
function sameText(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function clipText(v, n) { v = typeof v === 'string' ? v : (v == null ? '' : String(v)); return v.length > n ? v.slice(0, n) : v; }
/* A comment's context and pointer, trimmed to fit rather than refused: the first
   things to go are the least useful (page errors, recent clicks, settings). */
function fitCtx(x) {
  x = x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  var o = {}, k, size = function () { return JSON.stringify(o).length; };
  for (k in x) o[k] = x[k];
  if (size() <= 6000) return o;
  o.errors = Array.isArray(o.errors) ? o.errors.slice(-2) : [];
  o.actions = Array.isArray(o.actions) ? o.actions.slice(-4) : [];
  if (size() <= 6000) return o;
  delete o.errors; delete o.actions; o.settings = {};
  if (size() <= 6000) return o;
  return { name: clipText(x.name, 80), page: clipText(x.page, 300), heading: clipText(x.heading, 120), section: clipText(x.section, 80), kit: clipText(x.kit, 20), trimmed: true };
}
function fitWhere(w) {
  w = w && typeof w === 'object' && !Array.isArray(w) ? w : {};
  var o = {}, k;
  for (k in w) if (k !== 'el') o[k] = w[k];
  if (w.el && typeof w.el === 'object') o.el = { tag: clipText(w.el.tag, 20), role: clipText(w.el.role, 30), text: clipText(w.el.text, 120), path: clipText(w.el.path, 400), sel: clipText(w.el.sel, 600) };
  if (JSON.stringify(o).length <= 2000) return o;
  var n = {};
  ['x', 'y', 'w', 'h', 'vw', 'vh', 'xp', 'yp', 'wp', 'hp', 'sy'].forEach(function (f) { if (typeof w[f] === 'number' && isFinite(w[f])) n[f] = w[f]; });
  n.area = !!w.area; n.whole = !!w.whole;
  if (o.el) n.el = { tag: o.el.tag, text: clipText(o.el.text, 80), path: clipText(o.el.path, 200) };
  return n;
}
async function hashText(t) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 16);
}
function newCode() {
  var abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = '', r = new Uint8Array(6);
  crypto.getRandomValues(r);
  for (var i = 0; i < 6; i++) out += abc.charAt(r[i] % abc.length);
  return out;
}
async function feedback(request, env, url, json) {
  var DB = env.DB, what = url.pathname.slice('/api/fb/'.length);
  var fbTool = function (t) { t = String(t || '').toLowerCase(); return /^[a-z0-9-]{1,40}$/.test(t) ? t : null; };
  var fbId = function (t) { return typeof t === 'string' && /^[a-z0-9]{8,32}$/.test(t) ? t : null; };
  var team = function () { return !!env.FEEDBACK_KEY && sameText(request.headers.get('X-Team-Key'), env.FEEDBACK_KEY); };
  async function row(room, path) {
    var r = await DB.prepare('SELECT value, updated FROM kv WHERE room = ? AND path = ?').bind(room, path).first();
    return r ? JSON.parse(r.value) : null;
  }
  async function put(room, path, v) {
    await DB.prepare('INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ' +
      'ON CONFLICT(room, path) DO UPDATE SET value = excluded.value, updated = excluded.updated')
      .bind(room, path, JSON.stringify(v), Date.now()).run();
  }
  async function drop(room, path) { await DB.prepare('DELETE FROM kv WHERE room = ? AND path = ?').bind(room, path).run(); }
  async function testerCode() { var c = await row(FB_ADMIN, 'code'); return c && c.code ? c.code : null; }
  /* The tools list counts comments by counting them, so two posts at once can't count one twice. */
  async function recount(tool, last) {
    var n = await DB.prepare('SELECT COUNT(*) AS c FROM kv WHERE room = ? AND path >= ? AND path < ?').bind('fb:' + tool, 'c/', 'c0').first();
    var ix = await row(FB_ADMIN, 'tools/' + tool);
    await put(FB_ADMIN, 'tools/' + tool, { n: n ? n.c : 0, last: last || (ix && ix.last) || 0 });
  }

  if (request.method === 'GET') {
    if (what === 'check') {
      var cur = await testerCode();
      return json({ ok: !!cur && sameText(String(url.searchParams.get('code') || '').toUpperCase(), cur) });
    }
    if (!env.FEEDBACK_KEY) return json({ error: 'not set up' }, 503);
    if (!team()) return json({ error: 'locked' }, 401);
    if (what === 'tools') {
      var ts = await DB.prepare('SELECT path, value, updated FROM kv WHERE room = ? AND path >= ? AND path < ?').bind(FB_ADMIN, 'tools/', 'tools0').all();
      var tools = ts.results.map(function (x) { var v = JSON.parse(x.value); return { tool: x.path.slice(6), n: v.n || 0, last: v.last || 0 }; });
      return json({ tools: tools, code: await testerCode() });
    }
    if (what === 'list') {
      var lt = fbTool(url.searchParams.get('tool'));
      if (!lt) return json({ error: 'bad tool' }, 400);
      var rs = await DB.prepare('SELECT path, value, updated FROM kv WHERE room = ?').bind('fb:' + lt).all();
      var comments = [], reviews = {};
      rs.results.forEach(function (x) {
        var v = JSON.parse(x.value);
        if (x.path.indexOf('c/') === 0) { delete v.edit; comments.push(v); }
        else if (x.path.indexOf('r/') === 0) reviews[x.path.slice(2)] = v;
      });
      comments.sort(function (a, b) { return a.created - b.created; });
      return json({ comments: comments, reviews: reviews });
    }
    return json({ error: 'not found' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'not found' }, 404);
  var clen = parseInt(request.headers.get('content-length') || '0', 10);
  if (clen > 32000) return json({ error: 'too big' }, 413);
  /* Read as text first, so the size is checked even without a content-length. */
  var raw, body;
  try { raw = await request.text(); } catch (e) { return json({ error: 'bad body' }, 400); }
  if (raw.length > 32000 || new TextEncoder().encode(raw).length > 32000) return json({ error: 'too big' }, 413);
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad body' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);

  if (what === 'code') {
    if (!env.FEEDBACK_KEY) return json({ error: 'not set up' }, 503);
    if (!team()) return json({ error: 'locked' }, 401);
    var fresh = newCode();
    await put(FB_ADMIN, 'code', { code: fresh, at: Date.now() });
    return json({ ok: true, code: fresh });
  }
  var tool = fbTool(body.tool), id = fbId(body.id);
  if (!tool) return json({ error: 'bad tool' }, 400);
  if (!id) return json({ error: 'bad id' }, 400);
  var room = 'fb:' + tool;

  if (what === 'review') {
    if (!env.FEEDBACK_KEY) return json({ error: 'not set up' }, 503);
    if (!team()) return json({ error: 'locked' }, 401);
    var rv = body.review;
    if (!rv || typeof rv !== 'object') return json({ error: 'bad review' }, 400);
    var p0 = rv.priority === 'wont' ? 'ignore' : rv.priority;
    var pri = ['must', 'should', 'could', 'ignore', ''].indexOf(p0) > -1 ? p0 : '';
    var open = typeof rv.open === 'string' && /^git:[0-9a-f]{40}$/.test(rv.open) ? rv.open : '';
    var notes = (Array.isArray(rv.notes) ? rv.notes : []).slice(0, 20).map(function (n) {
      return { name: clipText(n && n.name, 60), text: clipText(n && n.text, 1000), at: +(n && n.at) || Date.now() };
    }).filter(function (n) { return n.text; });
    var clean = { priority: pri, open: open, notes: notes, by: clipText(rv.by, 60), at: Date.now() };
    if (JSON.stringify(clean).length > 8000) return json({ error: 'too big' }, 400);
    if (!(await row(room, 'c/' + id))) return json({ error: 'no such comment' }, 404);
    await put(room, 'r/' + id, clean);
    return json({ ok: true, review: clean });
  }

  var cur2 = await testerCode();
  var tester = !!cur2 && sameText(String(body.code || '').toUpperCase(), cur2);

  if (what === 'delete') {
    var had = await row(room, 'c/' + id);
    if (!had) return json({ ok: true });
    if (!team() && !(tester && sameText(body.edit, had.edit))) return json({ error: 'locked' }, 401);
    await drop(room, 'c/' + id); await drop(room, 'r/' + id);
    await put(room, 'd/' + id, { at: Date.now() });
    await recount(tool);
    return json({ ok: true });
  }

  if (what === 'post') {
    if (!tester) return json({ error: 'bad code' }, 401);
    if (typeof body.edit !== 'string' || !/^[A-Za-z0-9]{16,48}$/.test(body.edit)) return json({ error: 'bad edit token' }, 400);
    var c = body.comment;
    if (!c || typeof c !== 'object') return json({ error: 'bad comment' }, 400);
    var text = clipText(c.text, 4000).trim();
    if (!text || text.length > 2000) return json({ error: 'bad text' }, 400);
    var existing = await row(room, 'c/' + id), now = Date.now();
    if (existing && !sameText(body.edit, existing.edit)) return json({ error: 'locked' }, 401);
    var cu = typeof c.updated === 'number' && isFinite(c.updated) && c.updated > 0 ? c.updated : 0;
    if (existing && cu && existing.cu && cu < existing.cu) return json({ ok: true, created: existing.created, updated: existing.updated, stale: true });
    if (!existing && (await row(room, 'd/' + id))) return json({ ok: true, gone: true });
    var where, ctx;
    try {
      where = c.where === undefined && existing ? existing.where : fitWhere(c.where);
      ctx = c.ctx === undefined && existing ? existing.ctx : fitCtx(c.ctx);
    } catch (e) { where = {}; ctx = { trimmed: true }; }
    if (!existing) {
      var who = await hashText(request.headers.get('CF-Connecting-IP') || 'unknown');
      var rl = await row(FB_ADMIN, 'rl/' + who);
      if (!rl || now - rl.t0 > 3600000) rl = { n: 0, t0: now };
      if (rl.n >= FB_PER_HOUR) return json({ error: 'slow down' }, 429);
      var cnt = await DB.prepare('SELECT COUNT(*) AS c FROM kv WHERE room = ?').bind(room).first();
      if (cnt && cnt.c >= FB_COMMENTS_MAX * 2) return json({ error: 'full' }, 409);
      rl.n++; await put(FB_ADMIN, 'rl/' + who, rl);
    }
    var rec = {
      id: id, edit: body.edit, created: existing ? existing.created : now, updated: now,
      name: clipText(c.name, 60).trim(), text: text, ver: clipText(c.ver, 80), screen: clipText(c.screen, 80),
      where: where, ctx: ctx, cu: cu || (existing && existing.cu) || 0
    };
    await put(room, 'c/' + id, rec);
    if (!existing) await recount(tool, now);
    return json({ ok: true, created: rec.created, updated: now });
  }
  return json({ error: 'not found' }, 404);
}
