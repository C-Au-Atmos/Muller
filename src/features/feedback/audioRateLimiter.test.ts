import { describe, expect, it } from "vitest";

import { AudioRateLimiter } from "./audioRateLimiter";

describe("interface audio rate limiter", () => {
  it("allows the first sound and suppresses bursts inside the interval", () => {
    const limiter = new AudioRateLimiter(90);
    expect(limiter.allow(100)).toBe(true);
    expect(limiter.allow(150)).toBe(false);
    expect(limiter.allow(190)).toBe(true);
  });
});
