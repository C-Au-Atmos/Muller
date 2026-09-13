import { describe, expect, it } from "vitest";

import { formatSpaceBytes, spaceSnifferClient } from "./spaceSnifferClient";

describe("space sniffer client helpers", () => {
  it("formats scanner byte counts for the details panel", () => {
    expect(formatSpaceBytes(0)).toBe("0 B");
    expect(formatSpaceBytes(1024)).toBe("1.0 KB");
    expect(formatSpaceBytes(1024 ** 2 * 2.5)).toBe("2.5 MB");
  });

  it("honors cancellation before starting a scan", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(spaceSnifferClient.scan("C:\\", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
