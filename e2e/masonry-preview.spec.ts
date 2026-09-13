import { expect, test, type Page } from "@playwright/test";

import { installAlbumDirectoryMock, trackPageErrors } from "./helpers/albumDirectoryMock";

async function assertCompleteColumns(page: Page, pinned: boolean) {
  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  await expect.poll(async () => viewport.evaluate((element) => {
    const spacer = element.querySelector<HTMLElement>(".directory-grid-spacer")!.getBoundingClientRect();
    const bounds = Array.from(element.querySelectorAll<HTMLElement>(".directory-tile"), (tile) => tile.getBoundingClientRect());
    return bounds.length > 0
      && bounds.every((tile) => tile.left >= spacer.left - 0.1 && tile.right <= spacer.right + 0.1)
      && Math.abs(Math.max(...bounds.map((tile) => tile.right)) - spacer.right) < 0.1
      && Math.max(...bounds.map((tile) => tile.width)) - Math.min(...bounds.map((tile) => tile.width)) < 0.1
      && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  if (pinned) {
    const bounds = await viewport.boundingBox();
    const panel = await page.locator(".preview-panel").boundingBox();
    expect(bounds && panel && bounds.x + bounds.width <= panel.x).toBe(true);
  }
}

test("pinned album preview keeps complete columns through resizing", async ({ page }, testInfo) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.removeItem("muller.workspace.v1");
    localStorage.removeItem("muller.workspace.v2");
    localStorage.setItem("muller:tool-modes-expanded", "true");
    localStorage.setItem("muller:preview-pinned", "false");
  });
  await installAlbumDirectoryMock(page, 1_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();
  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  const tile = viewport.locator(".directory-tile:not(.is-placeholder)").first();
  await expect(tile).toBeVisible();
  await tile.click();
  const selectedPath = await tile.getAttribute("title");
  if (!selectedPath) throw new Error("Selected album image has no path");
  await assertCompleteColumns(page, false);

  await page.getByRole("button", { name: "Toggle preview" }).click();
  await page.getByRole("button", { name: "Pin preview to the page", exact: true }).click();
  await expect(page.locator(".browse-content")).toHaveClass(/is-preview-pinned/);
  await assertCompleteColumns(page, true);

  const resizer = page.getByRole("separator", { name: "Resize file preview" });
  const handle = await resizer.boundingBox();
  if (!handle) throw new Error("Preview divider is unavailable");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 175, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => resizer.getAttribute("aria-valuenow").then(Number)).toBeGreaterThan(480);
  await assertCompleteColumns(page, true);

  for (const width of [1280, 1173, 1024, 970, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await assertCompleteColumns(page, true);
    if (width === 970) await page.screenshot({ path: testInfo.outputPath("masonry-pinned-narrow.png") });
  }
  await resizer.press("ArrowRight");
  await assertCompleteColumns(page, true);
  await expect(viewport.locator('.directory-tile[aria-selected="true"]')).toHaveAttribute("title", selectedPath);
  await expect.poll(() => viewport.locator(".directory-tile:not(.is-placeholder)").count()).toBeLessThan(150);
  await page.screenshot({ path: testInfo.outputPath("masonry-pinned-resized.png") });
  await page.getByRole("button", { name: "Unpin preview overlay", exact: true }).click();
  await assertCompleteColumns(page, false);
  expect(errors).toEqual([]);
});
