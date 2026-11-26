// GET /api/stream?id=123            -> 302 redirect to the signed MP3 URL (play this URL directly)
// GET /api/stream?id=123&format=json -> { url, mimeType, durationMs, expiresInMs }
// The audio never goes through Vercel: only the lookup does.
const { sc, get, progressive, guard, fail, HttpError } = require('./_sc');

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const id = String((req.query && req.query.id) || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: 'missing_id' });

    const tr = await sc('/tracks/' + id);
    if (tr.r.status === 404) return res.status(404).json({ error: 'not_found' });
    if (tr.r.status === 429) return res.status(429).json({ error: 'rate_limited' });
    if (!tr.r.ok) return res.status(502).json({ error: 'soundcloud_http_' + tr.r.status });
    const track = await tr.r.json();

    if (track.streamable === false || (track.policy && track.policy !== 'ALLOW' && track.policy !== 'MONETIZE')) {
      return res.status(403).json({ error: 'not_full_free_track' });
    }
    const t = progressive(track);
    if (!t || !t.url) return res.status(404).json({ error: 'no_mp3_stream' });

    const url = t.url + (t.url.indexOf('?') >= 0 ? '&' : '?') +
      new URLSearchParams({ client_id: tr.id, track_authorization: track.track_authorization || '' });
    const s = await get(url);
    if (s.status === 429) return res.status(429).json({ error: 'rate_limited' });
    if (!s.ok) return res.status(502).json({ error: 'media_http_' + s.status });
    const body = await s.json();
    if (!body || !body.url) throw new HttpError(502, 'no_url');

    res.setHeader('Cache-Control', 'no-store');
    if (req.query.format === 'json') {
      return res.status(200).json({ url: body.url, mimeType: 'audio/mpeg', durationMs: track.duration || 0, expiresInMs: 240000 });
    }
    res.setHeader('Location', body.url);
    res.status(302).end();
  } catch (e) {
    fail(res, e);
  }
};
