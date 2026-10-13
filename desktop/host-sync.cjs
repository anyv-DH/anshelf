/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { randomUUID, createHash } = require('node:crypto');
const LIKE_DURATION_MS = 86400000;

// Library contents change only at atomic commits. Likes also change visibility
// with time, so their next boundary invalidates the token without a disk write.
function createSync({ library, queue, bridge, snapshot }) {
  const session = randomUUID();
  let scannedRevision = -1, nextLikeBoundary = -Infinity, likeEpoch = 0;
  function libraryToken(now) {
    if (scannedRevision !== library.revision || now >= nextLikeBoundary) {
      scannedRevision = library.revision; nextLikeBoundary = Infinity; likeEpoch++;
      for (const asset of library.state.assets) {
        const start = typeof asset.likedAt === 'string' ? Date.parse(asset.likedAt) : NaN;
        if (!Number.isFinite(start)) continue;
        const boundary = start > now ? start : start + LIKE_DURATION_MS;
        if (boundary > now) nextLikeBoundary = Math.min(nextLikeBoundary, boundary);
      }
    }
    return `${library.revision}:${likeEpoch}`;
  }
  return async function sync(knownVersion) {
    const status = await bridge.status(), queueState = queue.snapshot();
    // updatedAt and lastSeen are liveness evidence, not visible state. The
    // connected boolean still changes as soon as the heartbeat becomes stale.
    const { updatedAt: _updatedAt, ...heartbeat } = status.heartbeat || {};
    const semantic = JSON.stringify({ library: libraryToken(Date.now()), queue: queueState,
      bridge: { connected: status.connected, heartbeat, pending: status.pending, result: status.result } });
    const version = session + ':' + createHash('sha256').update(semantic).digest('hex');
    if (knownVersion === version) return { version };
    // Keep the token and payload from the same instant. No await between reading
    // the library and serializing the already-read bridge/queue values.
    return { version, snapshot: await snapshot({ bridge: status, queue: queueState }) };
  };
}
module.exports = { createSync };
