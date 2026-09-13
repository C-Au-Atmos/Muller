import { expect, test } from "@playwright/test";

test("Space Sniffer opens, selects, drills into a folder, and returns", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  // The app uses the English locale in the Playwright test environment, while
  // the Chinese locale labels this control "空间视图". Keep the assertion
  // locale-agnostic so the interaction exercises the same product surface in
  // either configured language.
  await page.getByRole("button", { name: /空间视图|Space map/ }).click();

  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect(region).toBeVisible();
  await expect(region.getByText("SPACE SNIFFER")).toBeVisible();

  const viewport = region.getByRole("application", { name: "Folder space map" });
  await viewport.click();
  await expect(region.getByRole("heading", { level: 2 })).toBeVisible();

  const breadcrumbs = region.getByRole("navigation", { name: "Folder path" }).getByRole("button");
  const rootBreadcrumbCount = await breadcrumbs.count();
  await viewport.dblclick();
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount + 1);

  await viewport.press("Escape");
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount);
  expect(errors).toEqual([]);
});

test("Space Sniffer restores an intermediate breadcrumb and Escape returns to the scan root", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /空间视图|Space map/ }).click();
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const breadcrumbs = region.getByRole("navigation", { name: "Folder path" });
  const parts = breadcrumbs.locator(".space-sniffer__crumb");
  const current = breadcrumbs.locator('[aria-current="page"]');
  await expect(current).toBeVisible();
  const rootPartCount = await parts.count();
  const rootName = await current.innerText();
  // Ancestors before the scan root must not offer an unsupported return path.
  await expect(breadcrumbs.getByRole("button")).toHaveCount(0);

  await viewport.dblclick();
  await expect(parts).toHaveCount(rootPartCount + 1);
  const intermediateName = await current.innerText();
  await viewport.dblclick();
  await expect(parts).toHaveCount(rootPartCount + 2);
  await expect(breadcrumbs.getByRole("button")).toHaveCount(2);
  await viewport.click();
  await expect(region.getByRole("heading", { level: 2 })).toBeVisible();

  await breadcrumbs.getByRole("button").nth(1).click();
  await expect(parts).toHaveCount(rootPartCount + 1);
  await expect(current).toHaveText(intermediateName);
  await expect(region.getByRole("heading", { level: 2 })).not.toBeVisible();
  await expect(viewport).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(parts).toHaveCount(rootPartCount);
  await expect(current).toHaveText(rootName);
  await expect(breadcrumbs.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(current).toHaveText(rootName);
  expect(errors).toEqual([]);
});
