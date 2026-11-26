# myspoti-soundcloud-api

Small Vercel API that searches SoundCloud and resolves full, free tracks to a playable MP3 URL.
No page has to stay open: the app calls this API directly.

- `GET /api/search?q=text&offset=0&limit=20` -> `{ items: [{ id, title, artist, uploader, durationMs, artwork, streamUrl }], next }`
- `GET /api/stream?id=ID` -> 302 to the signed MP3 (use this URL as the player source)
- `GET /api/stream?id=ID&format=json` -> `{ url, mimeType, durationMs, expiresInMs }`

Only full, free tracks with MP3 stream are returned (no previews, no paid-only).

## Optional env vars (Vercel > Settings > Environment Variables)

- `API_KEY`: if set, every request needs `?key=VALUE` or header `x-api-key`.
- `SC_CLIENT_ID`: fixed SoundCloud client_id. If empty, it is looked up automatically from soundcloud.com.

Unofficial: it uses SoundCloud's public web API and can stop working if they change it.
