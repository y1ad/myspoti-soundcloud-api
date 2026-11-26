// GET /api/search?q=text[&offset=0][&limit=20]
// -> { items: [{ id, title, artist, uploader, isrc, durationMs, artwork, mimeType, streamUrl }], next: offset|null }
// Add &debug=1 to see how many raw results SoundCloud returned and why they were filtered.
const { sc, playable, pickStream, origin, guard, fail } = require('./_sc');

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const q = String((req.query && req.query.q) || '').replace(/\s+/g, ' ').trim();
    if (!q) return res.status(400).json({ error: 'missing_q' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { r } = await sc('/search/tracks', { q, limit, offset, linked_partitioning: 1 });
    if (r.status === 429) return res.status(429).json({ error: 'rate_limited' });
    if (!r.ok) return res.status(502).json({ error: 'soundcloud_http_' + r.status });
    const data = await r.json();
    const raw = (data && data.collection) || [];

    if (req.query.debug) {
      return res.status(200).json({
        status: r.status,
        rawCount: raw.length,
        sample: raw.slice(0, 5).map((c) => ({
          title: c && c.title,
          streamable: c && c.streamable,
          policy: c && c.policy,
          transcodings: ((c && c.media && c.media.transcodings) || []).map((t) => (t.format && t.format.protocol) + ' ' + t.preset),
          picked: (c && pickStream(c) && pickStream(c).kind) || null
        }))
      });
    }

    const base = origin(req);
    const key = req.query.key ? '&key=' + encodeURIComponent(req.query.key) : '';
    const items = raw.filter(playable).map((c) => ({
      id: c.id,
      title: String(c.title || ''),
      artist: String((c.publisher_metadata && c.publisher_metadata.artist) || (c.user && c.user.username) || ''),
      uploader: String((c.user && c.user.username) || ''),
      isrc: String((c.publisher_metadata && c.publisher_metadata.isrc) || ''),
      durationMs: c.duration || 0,
      artwork: String(c.artwork_url || (c.user && c.user.avatar_url) || '').replace('-large.', '-t500x500.'),
      mimeType: pickStream(c).mime,
      streamUrl: base + '/api/stream?id=' + c.id + key
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items, next: data && data.next_href ? offset + limit : null });
  } catch (e) {
    fail(res, e);
  }
};
