import { expect, test, type Locator } from "@playwright/test";

async function customNumber(locator: Locator, property: string): Promise<number> {
  return locator.evaluate((element, name) => {
    const value = element.style.getPropertyValue(name);
    return Number.parseFloat(value);
  }, property);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
});

test("manual animation components remain restartable across repeated interactions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Option Wheel sidebar" }).click();
  const wheelItems = page.locator(".option-wheel__item");
  await expect(wheelItems).toHaveCount(1);

  // Strict Mode cancels the first scheduled frame while replaying effects. The
  // second setup must schedule a fresh frame and populate every visual value.
  await expect.poll(() => customNumber(wheelItems.nth(0), "--wheel-opacity")).toBeGreaterThan(0);
  await wheelItems.nth(0).click();
  await expect.poll(() => customNumber(wheelItems.nth(0), "--wheel-y")).toBeCloseTo(0, 1);
  await wheelItems.nth(0).click();
  await expect.poll(() => customNumber(wheelItems.nth(0), "--wheel-y")).toBeCloseTo(0, 1);

  await page.getByRole("button", { name: "Line Sidebar" }).click();
  const lineItems = page.locator(".line-sidebar__item");
  await expect(lineItems).toHaveCount(1);

  for (const index of [0]) {
    const item = lineItems.nth(index);
    await item.hover();
    await expect.poll(() => customNumber(item, "--line-effect")).toBeGreaterThan(0.2);

    // Clicking during an active frame changes the selected prop and exercises
    // the cancel/restart boundary that previously left a stale frame handle.
    await item.click();
    await page.mouse.move(700, 400);
  }

  const finalItem = lineItems.nth(0);
  await finalItem.hover();
  await expect.poll(() => customNumber(finalItem, "--line-effect")).toBeGreaterThan(0.2);
});
