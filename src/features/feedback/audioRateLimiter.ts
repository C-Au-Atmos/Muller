export class AudioRateLimiter {
  private lastPlayedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number) {}

  allow(now: number): boolean {
    if (now - this.lastPlayedAt < this.intervalMs) return false;
    this.lastPlayedAt = now;
    return true;
  }
}
