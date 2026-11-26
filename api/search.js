// GET /api/search?q=text[&offset=0][&limit=20]
// -> { items: [{ id, title, artist, durationMs, artwork, streamUrl }], next: offset|null }
const { sc, playable, origin, guard, fail } = require('./_sc');

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

    const base = origin(req);
    const key = req.query.key ? '&key=' + encodeURIComponent(req.query.key) : '';
    const items = ((data && data.collection) || []).filter(playable).map((c) => ({
      id: c.id,
      title: String(c.title || ''),
      artist: String((c.publisher_metadata && c.publisher_metadata.artist) || (c.user && c.user.username) || ''),
      uploader: String((c.user && c.user.username) || ''),
      durationMs: c.duration || 0,
      artwork: String(c.artwork_url || (c.user && c.user.avatar_url) || '').replace('-large.', '-t500x500.'),
      streamUrl: base + '/api/stream?id=' + c.id + key
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items, next: data && data.next_href ? offset + limit : null });
  } catch (e) {
    fail(res, e);
  }
};
