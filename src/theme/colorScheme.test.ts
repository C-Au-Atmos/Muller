import { describe, expect, it } from "vitest";

import {
  DEFAULT_DARK_COLOR_SCHEME,
  FLOW_BORDER_USAGE,
  MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME,
  THEME_COLOR_KEYS,
  THEME_COLOR_USAGE,
  parseThemeColorScheme,
  serializeThemeColorScheme,
} from "./colorScheme";

describe("theme color configuration", () => {
  it("defines and serializes every documented semantic color", () => {
    expect(Object.keys(DEFAULT_DARK_COLOR_SCHEME.colors)).toEqual([...THEME_COLOR_KEYS]);
    expect(Object.keys(THEME_COLOR_USAGE)).toEqual([...THEME_COLOR_KEYS]);
    const serialized = serializeThemeColorScheme(DEFAULT_DARK_COLOR_SCHEME);
    const exported = JSON.parse(serialized) as Record<string, unknown>;
    expect(exported.usage).toEqual(THEME_COLOR_USAGE);
    expect(exported.flowBorderUsage).toEqual(FLOW_BORDER_USAGE);
    expect(parseThemeColorScheme(exported)).toEqual(DEFAULT_DARK_COLOR_SCHEME);
  });

  it("defines the complete built-in Monochrome Platinum palette", () => {
    expect(Object.keys(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.colors)).toEqual([...THEME_COLOR_KEYS]);
    expect(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.mode).toBe("dark");
    expect(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.colors.canvas).toBe("#09090b");
    expect(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.colors.accent).toBe("#ffffff");
    expect(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.flowBorder).toMatchObject({
      enabled: true,
      width: 3,
      opacity: 0.88,
      colors: { idle: "#e4e4e7", highlight: "#ffffff" },
    });
    expect(parseThemeColorScheme(
      JSON.parse(serializeThemeColorScheme(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME)) as unknown,
    )).toEqual(MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME);
  });

  it("rejects incomplete, unknown, and unsafe color declarations", () => {
    const missing = structuredClone(DEFAULT_DARK_COLOR_SCHEME) as unknown as { colors: Record<string, string> };
    delete missing.colors.canvas;
    expect(parseThemeColorScheme(missing)).toBeNull();

    const unknown = structuredClone(DEFAULT_DARK_COLOR_SCHEME) as unknown as { colors: Record<string, string> };
    unknown.colors.unmapped = "#fff";
    expect(parseThemeColorScheme(unknown)).toBeNull();

    const unsafe = structuredClone(DEFAULT_DARK_COLOR_SCHEME);
    unsafe.colors.canvas = "url(https://example.test/pixel)";
    expect(parseThemeColorScheme(unsafe)).toBeNull();

    const invalidBorder = structuredClone(DEFAULT_DARK_COLOR_SCHEME);
    invalidBorder.flowBorder.width = 20;
    expect(parseThemeColorScheme(invalidBorder)).toBeNull();
  });

  it("keeps version 1 themes compatible while filling flow-border defaults", () => {
    const legacy = structuredClone(DEFAULT_DARK_COLOR_SCHEME) as unknown as Record<string, unknown>;
    delete legacy.flowBorder;
    expect(parseThemeColorScheme(legacy)?.flowBorder).toEqual(DEFAULT_DARK_COLOR_SCHEME.flowBorder);
  });
});
