import { expect, test } from "@playwright/test";

import { installAlbumDirectoryMock, trackPageErrors } from "./helpers/albumDirectoryMock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
});

test("Album masonry scrolling keeps the application root mounted", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  await expect(viewport).toBeVisible();

  // Browser-mode directory data is empty, so create enough scroll range to
  // exercise the same native scroll lifecycle as a large desktop album.
  await viewport.locator(".directory-grid-spacer").evaluate((element) => {
    element.style.height = "4000px";
  });
  await viewport.evaluate((element) => {
    element.scrollTop = 1200;
  });
  await page.waitForTimeout(100);

  await expect(page.locator(".stage7-shell")).toBeVisible();
  await expect(viewport).toBeVisible();
  expect(errors).toEqual([]);
});

test("Album selection moves with a spring without scrolling visible tiles", async ({ page }) => {
  await installAlbumDirectoryMock(page, 100);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = trackPageErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  const tiles = viewport.locator(".directory-tile:not(.is-placeholder)");
  const selection = viewport.locator(".directory-grid-selection");
  await expect(tiles.nth(1)).toBeVisible();
  await expect(selection).toBeVisible();
  await page.waitForTimeout(300);

  const start = await selection.boundingBox();
  const target = await tiles.nth(1).boundingBox();
  if (!start || !target) throw new Error("Album selection geometry is unavailable");
  const scrollBefore = await viewport.evaluate((element) => element.scrollTop);

  await page.evaluate(() => {
    const samples: number[] = [];
    Reflect.set(window, "__mullerAlbumSelectionSamples", samples);
    const deadline = performance.now() + 600;
    const capture = () => {
      const element = document.querySelector(".directory-grid-viewport.is-album .directory-grid-selection");
      if (element) samples.push(element.getBoundingClientRect().x);
      if (performance.now() < deadline) requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });
  await tiles.nth(1).click();
  await page.waitForTimeout(350);
  const samples = await page.evaluate(
    () => Reflect.get(window, "__mullerAlbumSelectionSamples") as number[],
  );
  const lowerBound = Math.min(start.x, target.x) + 1;
  const upperBound = Math.max(start.x, target.x) - 1;
  expect(samples.some((x) => x > lowerBound && x < upperBound)).toBe(true);

  const end = await selection.boundingBox();
  if (!end) throw new Error("Album selection disappeared after its transition");
  expect(end.x).toBeCloseTo(target.x, 0);
  expect(end.y).toBeCloseTo(target.y, 0);
  expect(end.width).toBeCloseTo(target.width, 0);
  expect(end.height).toBeCloseTo(target.height, 0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  expect(errors).toEqual([]);
});

test("Album includes camera RAW files and renders their Shell preview", async ({ page }) => {
  await installAlbumDirectoryMock(page, 4);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerAlbumFilters?: string[][] };
    return runtime.__mullerAlbumFilters?.at(-1) ?? [];
  })).toEqual(expect.arrayContaining(["cr2", "cr3", "nef", "arw", "dng", "raf", "rw2"]));

  const rawTile = page.locator(".directory-grid-viewport.is-album .directory-tile", { hasText: "image-0.cr3" }).first();
  await expect(rawTile).toBeVisible();
  await rawTile.click();
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel .preview-content img")).toBeVisible();
  await expect(page.locator(".preview-panel")).toContainText("image-0.cr3");
});

test("Album and the preview panel play GIF files from the original source", async ({ page }) => {
  await installAlbumDirectoryMock(page, 4);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const gifTile = page.locator(".directory-grid-viewport.is-album .directory-tile", { hasText: "image-1.gif" }).first();
  await expect(gifTile).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    return runtime.__mullerConvertedPaths?.some((path) => /image-1\.gif$/i.test(path)) ?? false;
  })).toBe(true);
  await gifTile.click();
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    if (runtime.__mullerConvertedPaths) runtime.__mullerConvertedPaths.length = 0;
  });
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel .preview-content img")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    return runtime.__mullerConvertedPaths?.some((path) => /image-1\.gif$/i.test(path)) ?? false;
  })).toBe(true);
});
