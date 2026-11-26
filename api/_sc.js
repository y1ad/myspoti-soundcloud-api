// Shared SoundCloud helpers. Files starting with "_" are not exposed as routes by Vercel.
// Uses SoundCloud's public web API with a client_id read from the site's own scripts.
const API = 'https://api-v2.soundcloud.com';
const HOME = 'https://soundcloud.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 6 * 3600 * 1000;

let cid = null;
let cidAt = 0;

async function get(url, timeout = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

async function discover() {
  const home = await get(HOME);
  if (!home.ok) return null;
  const html = await home.text();
  const urls = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map((m) => m[1])
    .reverse();
  for (let i = 0; i < urls.length && i < 8; i += 4) {
    const bodies = await Promise.all(
      urls.slice(i, i + 4).map((u) => get(u).then((r) => (r.ok ? r.text() : '')).catch(() => ''))
    );
    for (const b of bodies) {
      const m = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/.exec(b);
      if (m) return m[1];
    }
  }
  return null;
}

async function clientId(force) {
  if (process.env.SC_CLIENT_ID) return process.env.SC_CLIENT_ID;
  if (!force && cid && Date.now() - cidAt < TTL) return cid;
  const found = await discover();
  if (found) {
    cid = found;
    cidAt = Date.now();
    return cid;
  }
  return force ? null : cid;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// GET [path] on SoundCloud's API; refreshes the client_id once if it was refused.
async function sc(path, params = {}) {
  let id = await clientId(false);
  if (!id) throw new HttpError(502, 'no_client_id');
  const build = (c) => API + path + '?' + new URLSearchParams({ ...params, client_id: c });
  let r = await get(build(id));
  if (r.status === 401 || r.status === 403) {
    id = await clientId(true);
    if (!id) throw new HttpError(502, 'no_client_id');
    r = await get(build(id));
  }
  return { r, id };
}

// The progressive MP3 transcoding (any audio player opens it directly). Rare today.
function progressive(c) {
  const t = (c.media && c.media.transcodings) || [];
  return (
    t.find((x) => x.format && x.format.protocol === 'progressive' && /mpeg|mp3/i.test((x.format.mime_type || '') + ' ' + (x.preset || ''))) ||
    null
  );
}

// The stream to use: a progressive MP3 when there is one, else the best HLS AAC (160k > 96k).
function pickStream(c) {
  const mp3 = progressive(c);
  if (mp3) return { t: mp3, mime: 'audio/mpeg', kind: 'mp3' };
  const t = (c.media && c.media.transcodings) || [];
  const rate = (x) => parseInt(((x.preset || '').match(/(\d+)k/) || [])[1], 10) || 0;
  const aac = t
    .filter((x) => x.format && x.format.protocol === 'hls' && /mp4a|aac/i.test((x.format.mime_type || '') + ' ' + (x.preset || '')))
    .sort((a, b) => rate(b) - rate(a));
  if (aac.length) return { t: aac[0], mime: 'application/x-mpegURL', kind: 'hls-aac' };
  return null;
}

function playable(c) {
  if (!c || c.streamable === false) return false;
  if (c.policy && c.policy !== 'ALLOW' && c.policy !== 'MONETIZE') return false; // no previews, no paid-only
  return !!pickStream(c);
}

function origin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + req.headers.host;
}

// CORS + optional API key (set API_KEY in Vercel to require ?key= or x-api-key). Returns false if it answered.
function guard(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  const need = process.env.API_KEY;
  if (need) {
    const got = req.headers['x-api-key'] || (req.query && req.query.key);
    if (got !== need) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
  }
  return true;
}

function fail(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.code });
  return res.status(500).json({ error: 'internal', detail: String((e && e.message) || e) });
}

module.exports = { API, UA, get, sc, playable, progressive, pickStream, origin, guard, fail, HttpError };
