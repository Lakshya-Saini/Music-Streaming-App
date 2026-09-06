const STREAM_CACHE = 'sonora-stream-prefix-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const range = event.request.headers.get('range');

  if (
    event.request.method !== 'GET' ||
    !range ||
    !url.pathname.match(/\/api\/v1\/tracks\/[^/]+\/stream$/)
  ) {
    return;
  }

  event.respondWith(handleStreamRange(event, range));
});

async function handleStreamRange(event, rangeHeader) {
  const request = event.request;
  const requested = parseRange(rangeHeader);
  if (!requested) {
    return fetch(request);
  }

  const cached = await readCachedPrefix(request.url);
  if (cached && requested.start <= cached.end) {
    const responseEnd = Math.min(requested.end ?? cached.end, cached.end);
    return rangeResponse(cached, requested.start, responseEnd);
  }

  const response = await fetch(request);
  if (response.status === 206 && requested.start === 0) {
    /**
     * Caching must not block the response: awaiting it here would hold up
     * every byte from reaching the <audio> element until this clone's body
     * had been fully read, which - once the server started returning larger
     * ranges - meant playback couldn't start until an entire chunk (or, before
     * the server capped ranges, the whole file) had downloaded twice over.
     * `waitUntil` lets the real response go out immediately while caching
     * happens in the background.
     */
    event.waitUntil(cachePrefix(request.url, response.clone()));
  }

  return response;
}

function parseRange(rangeHeader) {
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) {
    return null;
  }

  return {
    start: Number(match[1]),
    end: match[2] ? Number(match[2]) : null,
  };
}

async function cachePrefix(url, response) {
  const contentRange = response.headers.get('content-range');
  const parsed = parseContentRange(contentRange);
  if (!parsed || parsed.start !== 0) {
    return;
  }

  const existing = await readCachedPrefix(url);
  if (existing && existing.end >= parsed.end) {
    return;
  }

  const buffer = await response.arrayBuffer();
  const cache = await caches.open(STREAM_CACHE);
  const headers = new Headers();
  headers.set('content-type', response.headers.get('content-type') ?? 'audio/mp4');
  headers.set('x-prefix-end', String(parsed.end));
  headers.set('x-total-size', String(parsed.total));

  await cache.put(cacheKey(url), new Response(buffer, { headers }));
}

async function readCachedPrefix(url) {
  const cache = await caches.open(STREAM_CACHE);
  const response = await cache.match(cacheKey(url));
  if (!response) {
    return null;
  }

  const end = Number(response.headers.get('x-prefix-end'));
  const total = Number(response.headers.get('x-total-size'));
  if (!Number.isFinite(end) || !Number.isFinite(total)) {
    return null;
  }

  return {
    buffer: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? 'audio/mp4',
    end,
    total,
  };
}

function rangeResponse(cached, start, end) {
  const body = cached.buffer.slice(start, end + 1);
  return new Response(body, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${end}/${cached.total}`,
      'Content-Type': cached.contentType,
      'X-Stream-Cache': 'hit',
    },
  });
}

function parseContentRange(contentRange) {
  const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  };
}

function cacheKey(url) {
  return new Request(
    new URL(`/__sonora_stream_prefix?url=${encodeURIComponent(url)}`, self.location.origin),
  );
}
