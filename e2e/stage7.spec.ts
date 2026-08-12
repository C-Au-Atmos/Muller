import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const artifactDirectory = path.resolve("test-results", "stage7");

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectMouseTargets(page: Page, context: string): Promise<void> {
  const undersized = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      if (button.matches(".pane-resizer, .preview-resizer, .inspector-resizer, .sidebar-resizer")) return [];
      const bounds = button.getBoundingClientRect();
      if (
        bounds.width >= 31.5 &&
        bounds.height >= 31.5 &&
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth
      ) return [];
      return [{
        name: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "unnamed",
        className: button.getAttribute("class") ?? "",
        left: Math.round(bounds.left * 10) / 10,
        right: Math.round(bounds.right * 10) / 10,
        width: Math.round(bounds.width * 10) / 10,
        height: Math.round(bounds.height * 10) / 10,
      }];
    }),
  );
  expect(undersized, `${context} has invalid mouse targets`).toEqual([]);
}

test.beforeAll(async () => {
  await mkdir(artifactDirectory, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("muller.e2e.initialized") === "true") return;
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
    window.sessionStorage.setItem("muller.e2e.initialized", "true");
  });
});

test("Stage 7 V5 shell, GradientText, tabs, rails, filters, and views are integrated", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");

  const topbar = page.locator(".stage7-topbar");
  const addressbar = page.locator(".stage7-addressbar");
  const toolbar = page.locator(".tool-ribbon");
  const rail = page.locator(".location-rail");
  await expect(topbar).toBeVisible();
  await expect(addressbar).toBeVisible();
  await expect(toolbar).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(topbar).toHaveCSS("height", "42px");
  await expect(addressbar).toHaveCSS("height", "52px");
  await expect(toolbar).toHaveCSS("height", "48px");
  await expect(rail).toHaveCSS("width", "210px");
  const sidebarSeparator = page.getByRole("separator", { name: "Resize navigation sidebar" });
  await expect(sidebarSeparator).toBeVisible();
  await sidebarSeparator.focus();
  await sidebarSeparator.press("ArrowRight");
  await expect(sidebarSeparator).toHaveAttribute("aria-valuenow", "218");
  await expect(rail).toHaveCSS("width", "218px");
  await sidebarSeparator.press("ArrowLeft");
  await expect(rail).toHaveCSS("width", "210px");

  const brand = page.locator(".gradient-text__content");
  await expect(brand).toHaveText("Muller");
  const brandStyle = await brand.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    document.body.append(probe);
    const palette = ["--accent", "--info", "--text-secondary"].map((variable) => {
      probe.style.color = `var(${variable})`;
      return getComputedStyle(probe).color;
    });
    probe.remove();
    return { image: style.backgroundImage, color: style.color, palette };
  });
  for (const color of brandStyle.palette) expect(brandStyle.image).toContain(color);
  expect(brandStyle.color).toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator(".brand-copy small")).toHaveCount(0);
  await expect(page.locator(".brand-copy .gradient-text")).toHaveCSS("font-size", "17px");
  await expect(page.locator(".color-bends")).toHaveCount(0);
  await page.locator(".brand-lockup").click();
  await expect(page.locator(".color-bends")).toHaveAttribute("data-renderer", "three-webgl");
  await expect(page.locator(".color-bends")).toHaveClass(/is-home/);
  await expect.poll(async () => {
    const png = PNG.sync.read(await page.locator(".color-bends").screenshot({ omitBackground: true }));
    let painted = 0;
    for (let index = 3; index < png.data.length; index += 64) {
      if ((png.data[index] ?? 0) > 8) painted += 1;
    }
    return painted;
  }).toBeGreaterThan(20);
  await page.getByRole("tab").first().click();
  await expect(page.locator(".color-bends")).toHaveCount(0);
  await page.screenshot({ path: path.join(artifactDirectory, "browse-option-wheel-v5.png"), fullPage: true });

  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "New workspace tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: /Close Muller/ }).last().click();
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.getByRole("button", { name: "Line Sidebar" }).click();
  await expect(page.locator(".line-sidebar")).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, "browse-line-sidebar-v5.png"), fullPage: true });
  await page.getByRole("button", { name: "Option Wheel sidebar" }).click();
  await expect(page.locator(".option-wheel")).toBeVisible();

  await expect(page.locator(".workspace-filter-menu")).toHaveCount(0);
  await page.getByRole("button", { name: /Filters/ }).click();
  const filterMenu = page.getByRole("complementary", { name: "Filters" });
  await expect(filterMenu).toBeVisible();
  await page.getByRole("checkbox", { name: /Enabled/ }).check();
  await page.screenshot({ path: path.join(artifactDirectory, "filter-open-v5.png"), fullPage: true });
  await page.getByRole("button", { name: "Close filters" }).click();
  await expect(filterMenu).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Filters/ }).locator("b")).toHaveText("1");

  const separator = page.getByRole("separator", { name: "Resize directory panes" });
  const leftScrollbarHit = await page.locator(".directory-pane").first().evaluate((pane) => {
    const paneBounds = pane.getBoundingClientRect();
    const target = document.elementFromPoint(paneBounds.right - 1, paneBounds.top + paneBounds.height / 2);
    return target instanceof Element && target.closest(".pane-resizer") !== null;
  });
  expect(leftScrollbarHit).toBe(false);
  const initialRatio = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(initialRatio + 2));

  await page.getByRole("button", { name: "Large icons" }).click();
  await expect(page.locator(".directory-grid-viewport.is-cubes-grid")).toHaveCount(2);
  await page.getByRole("button", { name: /Album/ }).click();
  await expect(page.locator(".directory-grid-viewport.is-album")).toHaveCount(2);
  await expect(page.locator(".directory-pane:visible")).toHaveCount(1);

  await page.locator(".brand-lockup").click();
  await expect(page.getByRole("region", { name: "Home dashboard" })).toBeVisible();
  await expect(page.locator(".spotlight-card")).toHaveCount(4);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".brand-lockup").click();
  await expect(page.getByRole("region", { name: "Home dashboard" })).toBeVisible();

  await page.screenshot({ path: path.join(artifactDirectory, "desktop-v5.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("navigation sidebar pointer resizing persists and compact mode stays fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");

  const rail = page.locator(".location-rail");
  const separator = page.getByRole("separator", { name: "Resize navigation sidebar" });
  const separatorBox = await separator.boundingBox();
  if (!separatorBox) throw new Error("Sidebar resizer is not measurable");

  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(separatorBox.x + separatorBox.width / 2 + 64, separatorBox.y + 100);
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "274");
  await expect(rail).toHaveCSS("width", "274px");

  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize navigation sidebar" })).toHaveAttribute("aria-valuenow", "274");
  await expect(rail).toHaveCSS("width", "274px");

  await page.setViewportSize({ width: 760, height: 520 });
  await expect(separator).toBeHidden();
  await expect(rail).toHaveCSS("width", "58px");
});

for (const viewport of [
  { width: 1360, height: 840 },
  { width: 760, height: 520 },
  { width: 390, height: 844 },
]) {
  test(`Stage 7 keeps visible mouse targets at least 32px at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expectMouseTargets(page, "Browse");

    await page.getByRole("button", { name: "Line Sidebar" }).click();
    await expectMouseTargets(page, "Line Sidebar");

    await page.getByRole("button", { name: /Filters/ }).click();
    const filterMenu = page.getByRole("complementary", { name: "Filters" });
    await expect(filterMenu).toBeVisible();
    await expect(filterMenu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expectMouseTargets(page, "Filters");
    await page.getByRole("button", { name: "Close filters" }).click();

    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expectMouseTargets(page, "Command palette");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Duplicates", exact: true }).click();
    await expectMouseTargets(page, "Duplicates");
    await page.getByRole("button", { name: "Compare", exact: true }).first().click();
    await expectMouseTargets(page, "Compare");
  });
}

test("Stage 7 wide and 4K layout preserves fixed chrome and bounded content", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto("/");
  await expect(page.locator(".stage7-topbar")).toHaveCSS("height", "42px");
  await expect(page.locator(".stage7-addressbar")).toHaveCSS("height", "52px");
  await expect(page.locator(".tool-ribbon")).toHaveCSS("height", "48px");
  const measurements = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    mountedDirectoryRows: document.querySelectorAll(".directory-row").length,
    contexts: document.querySelectorAll("canvas").length,
  }));
  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth);
  expect(measurements.mountedDirectoryRows).toBeLessThan(200);
  expect(measurements.contexts).toBeLessThanOrEqual(2);
  await page.screenshot({ path: path.join(artifactDirectory, "4k-v5.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("Stage 7 directory selection uses one visual surface", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");

  const styles = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".stage7-shell");
    if (!shell) throw new Error("Stage 7 shell is missing");

    const viewport = document.createElement("div");
    viewport.className = "directory-list-viewport is-active";
    const regular = document.createElement("div");
    regular.className = "directory-row";
    const selected = document.createElement("div");
    selected.className = "directory-row is-selected";
    const surface = document.createElement("div");
    surface.className = "selection-surface";
    selected.append(surface);
    viewport.append(regular, selected);
    shell.append(viewport);

    const regularStyle = getComputedStyle(regular);
    const selectedStyle = getComputedStyle(selected);
    const surfaceStyle = getComputedStyle(surface);
    const colorProbe = document.createElement("div");
    colorProbe.style.backgroundColor = "var(--accent-soft)";
    shell.append(colorProbe);
    const result = {
      regularBackground: regularStyle.backgroundColor,
      selectedBackground: selectedStyle.backgroundColor,
      selectedShadow: selectedStyle.boxShadow,
      surfaceBackground: surfaceStyle.backgroundColor,
      surfaceBorder: surfaceStyle.borderTopColor,
      surfaceRadius: surfaceStyle.borderRadius,
      surfaceShadow: surfaceStyle.boxShadow,
      accentSoft: getComputedStyle(colorProbe).backgroundColor,
    };
    colorProbe.remove();
    viewport.remove();
    return result;
  });

  expect(styles.selectedBackground).toBe(styles.regularBackground);
  expect(styles.selectedShadow).toBe("none");
  expect(styles.surfaceBackground).toBe(styles.accentSoft);
  expect(styles.surfaceBorder).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.surfaceRadius).toBe("4px");
  expect(styles.surfaceShadow).toBe("none");
});

test("Stage 7 resizers persist and duplicate task state stays with its owner tab", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle preview" }).click();
  const previewResizer = page.getByRole("separator", { name: "Resize file preview" });
  await expect(previewResizer).toBeVisible();
  const previewWidth = Number(await previewResizer.getAttribute("aria-valuenow"));
  await previewResizer.focus();
  await previewResizer.press("ArrowLeft");
  await expect(previewResizer).toHaveAttribute("aria-valuenow", String(previewWidth + 8));
  await page.getByRole("button", { name: "Close preview" }).click();

  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  const inspectorResizer = page.getByRole("separator", { name: "Resize scan inspector" });
  await expect(inspectorResizer).toBeVisible();
  const inspectorWidth = Number(await inspectorResizer.getAttribute("aria-valuenow"));
  await inspectorResizer.focus();
  await inspectorResizer.press("ArrowLeft");
  await expect(inspectorResizer).toHaveAttribute("aria-valuenow", String(inspectorWidth + 8));

  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.locator(".scan-status")).toHaveText("Failed");
  await page.getByRole("button", { name: "New workspace tab" }).click();
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  await expect(page.locator(".scan-status")).toHaveText("Ready");
  expect(errors).toEqual([]);
});

test("Stage 7 persists rail, scale, filter, and tabs while rejecting viewport overflow", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");
  await page.getByRole("button", { name: "Line Sidebar" }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("slider", { name: "UI scale" }).fill("110");
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("checkbox", { name: /Enabled/ }).check();
  await page.getByRole("button", { name: "Close filters" }).click();
  await page.getByRole("button", { name: "New workspace tab" }).click();
  await page.getByRole("tab").first().click();
  await page.reload();

  await expect(page.locator(".line-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("slider", { name: "UI scale" })).toHaveValue("110");
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Filters/ }).locator("b")).toHaveText("1");
  await page.setViewportSize({ width: 760, height: 520 });

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    outside: Array.from(document.querySelectorAll<HTMLElement>("button")).filter((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < 0 || bounds.right > innerWidth);
    }).length,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.outside).toBe(0);
  await page.screenshot({ path: path.join(artifactDirectory, "minimum-v5.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("Stage 7 compact viewport keeps commands reachable and Filter conditional", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
  const errors = trackPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Duplicates/ })).toBeVisible();
  await page.getByRole("button", { name: /Duplicates/ }).click();
  await expect(page.locator(".duplicate-result-pane")).toBeVisible();
  await page.getByRole("button", { name: /Browse/ }).click();
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
  await page.keyboard.press("Escape");

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    outside: Array.from(document.querySelectorAll<HTMLElement>("button")).filter((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < 0 || bounds.right > innerWidth);
    }).length,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.outside).toBe(0);
  await page.screenshot({ path: path.join(artifactDirectory, "compact-v5.png"), fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
