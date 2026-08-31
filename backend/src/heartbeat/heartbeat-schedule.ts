const HEARTBEAT_MIN_DELAY_MS = 2 * 60 * 1000;
const HEARTBEAT_MAX_DELAY_MS = 6 * 60 * 1000;

export function nextHeartbeatCheckAt(referenceAt: Date): Date {
  const heartbeatDelayMs =
    HEARTBEAT_MIN_DELAY_MS +
    Math.floor(
      Math.random() *
        (HEARTBEAT_MAX_DELAY_MS - HEARTBEAT_MIN_DELAY_MS + 1),
    );

  return new Date(referenceAt.getTime() + heartbeatDelayMs);
}
