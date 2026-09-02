import { describe, expect, it } from "vitest";

import { audioVolumeGain, parsePreferences, resolveLocale } from "./preferencesModel";

describe("Stage 7.10 preferences", () => {
  it("clamps persisted values and migrates workspace preferences", () => {
    const value = parsePreferences(
      JSON.stringify({ uiScale: 900, audioVolume: -3, hoverDelayMs: 900, sidebarMode: "bad" }),
      JSON.stringify({ uiScale: 110, sidebarMode: "line" }),
    );
    expect(value.uiScale).toBe(125);
    expect(value.audioVolume).toBe(0);
    expect(value.hoverDelayMs).toBe(300);
    expect(value.sidebarMode).toBe("classic");
    expect(value.glassBackground).toBe(false);
    expect(value.mediaAutoplay).toBe(false);
  });

  it("uses a perceptual volume curve and system-language fallback", () => {
    expect(audioVolumeGain(0)).toBe(0);
    expect(audioVolumeGain(50)).toBeCloseTo(0.2586, 4);
    expect(audioVolumeGain(100)).toBe(1.55);
    expect(resolveLocale("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "fr-FR")).toBe("en-US");
  });

  it("keeps the Monochrome Platinum built-in theme preference", () => {
    expect(parsePreferences(null).theme).toBe("platinum");
    expect(parsePreferences(JSON.stringify({ theme: "invalid" })).theme).toBe("platinum");
    expect(parsePreferences(JSON.stringify({ theme: "platinum" })).theme).toBe("platinum");
    expect(parsePreferences(JSON.stringify({ theme: "system" })).theme).toBe("system");
    expect(parsePreferences(JSON.stringify({ theme: "dark" })).theme).toBe("dark");
    expect(parsePreferences(JSON.stringify({ theme: "light" })).theme).toBe("light");
  });

  it("persists the optional frosted-glass appearance", () => {
    expect(parsePreferences(JSON.stringify({ glassBackground: true })).glassBackground).toBe(true);
    expect(parsePreferences(JSON.stringify({ glassBackground: "true" })).glassBackground).toBe(false);
  });

  it("persists media autoplay only as an explicit boolean", () => {
    expect(parsePreferences(JSON.stringify({ mediaAutoplay: true })).mediaAutoplay).toBe(true);
    expect(parsePreferences(JSON.stringify({ mediaAutoplay: "true" })).mediaAutoplay).toBe(false);
  });

  it("defaults and migrates desktop lifecycle preferences", () => {
    expect(parsePreferences(null).closeBehavior).toBe("hide");
    expect(parsePreferences(null).autostartEnabled).toBe(false);
    expect(parsePreferences(JSON.stringify({ closeBehavior: "quit", autostartEnabled: true }))).toMatchObject({
      closeBehavior: "quit",
      autostartEnabled: true,
    });
    expect(parsePreferences(JSON.stringify({ closeBehavior: "invalid", autostartEnabled: "true" }))).toMatchObject({
      closeBehavior: "hide",
      autostartEnabled: false,
    });
    expect(parsePreferences("{broken").closeBehavior).toBe("hide");
  });
});
