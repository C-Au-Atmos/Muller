import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const artifactDirectory = path.resolve("test-results", "visual");

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function waitForWorkerFrames(page: Page): Promise<void> {
  await expect(page.locator(".live-metrics")).toContainText("Worker GL");
  await expect
    .poll(async () => {
      const label = await page.locator(".live-metrics span").nth(1).textContent();
      return Number.parseInt(label ?? "0", 10);
    })
    .toBeGreaterThan(0);
}

async function findLargeDarkSurfaces(page: Page): Promise<string[]> {
  return page.locator(".stage7-shell").evaluate((shell) => {
    const offenders = new Set<string>();
    for (const element of Array.from(shell.querySelectorAll<HTMLElement>("*"))) {
      if (element instanceof HTMLCanvasElement || element instanceof HTMLImageElement || element instanceof HTMLVideoElement) continue;
      const rectangle = element.getBoundingClientRect();
      if (rectangle.width * rectangle.height < 1500 || rectangle.bottom <= 0 || rectangle.right <= 0) continue;
      const background = window.getComputedStyle(element).backgroundColor;
      const channels = background.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3 || (channels[3] ?? 1) < 0.55) continue;
      const [red = 255, green = 255, blue = 255] = channels;
      const channelScale = background.startsWith("color(srgb") ? 1 : 255;
      const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / channelScale;
      if (luminance < 0.12) {
        offenders.add([
          `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}`,
          `label=${element.getAttribute("aria-label") ?? ""}`,
          `text=${(element.textContent ?? "").trim().slice(0, 28)}`,
          `background=${background}`,
          `size=${Math.round(rectangle.width)}x${Math.round(rectangle.height)}`,
        ].join("|"));
      }
    }
    return [...offenders];
  });
}

test.beforeAll(async () => {
  await mkdir(artifactDirectory, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
});

test("worker border survives list pressure and paints only the edge ribbon", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Muller", { exact: true }).first()).toBeVisible();
  await waitForWorkerFrames(page);
  await expect(page.locator(".worker-warning")).toHaveCount(0);
  await expect(page.locator(".stage7-shell")).toHaveCSS("padding", "0px");
  await expect(page.locator(".stage7-shell")).toHaveCSS("border-radius", "12px");
  await expect(page.locator(".flow-border")).toHaveCSS("padding", "3px");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("#root")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.keyboard.press("Control+l");
  await expect(page.getByRole("combobox", { name: "Current directory" })).toHaveValue("D:\\Muller");
  await page.keyboard.press("Escape");
  await expect(page.locator(".directory-pane")).toHaveCount(2);
  await page.locator(".directory-list-viewport").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Paste" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+2");
  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.locator(".live-metrics")).toContainText("Worker GL");

  await page.screenshot({
    path: path.join(artifactDirectory, "desktop.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) throw new Error("App shell not found");
    shell.style.background = "transparent";
    for (const child of Array.from(shell.children)) {
      if (!child.classList.contains("flow-border")) {
        (child as HTMLElement).style.visibility = "hidden";
      }
    }
  });

  const borderOnly = await page.screenshot({ omitBackground: true });
  const png = PNG.sync.read(borderOnly);
  let opaquePixels = 0;
  let centerOpaquePixels = 0;
  let centerPixels = 0;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alphaIndex = (y * png.width + x) * 4 + 3;
      const alpha = png.data[alphaIndex] ?? 0;
      if (alpha > 16) opaquePixels += 1;

      const inCenter =
        x > png.width * 0.25 &&
        x < png.width * 0.75 &&
        y > png.height * 0.25 &&
        y < png.height * 0.75;
      if (inCenter) {
        centerPixels += 1;
        if (alpha > 16) centerOpaquePixels += 1;
      }
    }
  }

  const opaqueRatio = opaquePixels / (png.width * png.height);
  expect(opaqueRatio).toBeGreaterThan(0.01);
  expect(opaqueRatio).toBeLessThan(0.12);
  expect(centerOpaquePixels / centerPixels).toBeLessThan(0.001);
  const cornerAlpha = png.data[3] ?? 255;
  const topCenterAlpha = png.data[(Math.floor(png.width / 2) * 4) + 3] ?? 0;
  expect(cornerAlpha).toBeLessThan(16);
  expect(topCenterAlpha).toBeGreaterThan(16);
  expect(errors).toEqual([]);
});

test("narrow viewport remains contained with the Worker renderer", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = trackPageErrors(page);
  await page.goto("/");
  await waitForWorkerFrames(page);
  await expect(page.locator(".breadcrumb-address")).toBeVisible();
  await expect(page.locator(".directory-pane:visible")).toHaveCount(2);

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shellWidth: document.querySelector<HTMLElement>(".app-shell")?.scrollWidth ?? 0,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.shellWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  const buttonsOutsideViewport = await page.locator("button:visible").evaluateAll(
    (buttons) =>
      buttons.filter((button) => {
        const rectangle = button.getBoundingClientRect();
        return rectangle.left < 0 || rectangle.right > window.innerWidth;
      }).length,
  );
  expect(buttonsOutsideViewport).toBe(0);

  await page.screenshot({
    path: path.join(artifactDirectory, "mobile.png"),
    fullPage: true,
  });

  await page.keyboard.press("Control+2");
  await page.keyboard.press("Control+f");
  await expect(page.getByRole("textbox", { name: "Search duplicate results" })).toBeFocused();
  const duplicateDimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    buttonsOutside: Array.from(document.querySelectorAll<HTMLElement>("button:enabled"))
      .filter((button) => {
        const rectangle = button.getBoundingClientRect();
        return rectangle.width > 0 &&
          (rectangle.left < 0 || rectangle.right > window.innerWidth);
      }).length,
  }));
  expect(duplicateDimensions.documentWidth).toBeLessThanOrEqual(
    duplicateDimensions.viewportWidth,
  );
  expect(duplicateDimensions.buttonsOutside).toBe(0);
  await page.screenshot({
    path: path.join(artifactDirectory, "stage6-1-mobile-search.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await context.close();
});

test("CSS fallback keeps the center transparent and preserves direction", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.addInitScript(() => {
    Reflect.deleteProperty(
      HTMLCanvasElement.prototype,
      "transferControlToOffscreen",
    );
  });
  const page = await context.newPage();
  const errors = trackPageErrors(page);
  await page.goto("/");

  await expect(page.locator(".flow-css-fallback")).toBeVisible();
  await page.keyboard.press("Control+l");
  const address = page.getByRole("combobox", { name: "Current directory" });
  await address.fill("D:\\Muller\\src");
  await address.press("Enter");
  await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-flow-direction", "back");

  const fallbackPaint = await page.locator(".flow-css-fallback").evaluate((element) => {
    const style = window.getComputedStyle(element);
    const borderStyle = window.getComputedStyle(element.parentElement as HTMLElement);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderRadius: style.borderRadius,
      maskImage: borderStyle.maskImage || borderStyle.webkitMaskImage,
    };
  });
  expect(fallbackPaint.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(fallbackPaint.backgroundImage).toContain("conic-gradient");
  expect(fallbackPaint.borderRadius).toBe("12px");
  expect(fallbackPaint.maskImage).toContain("linear-gradient");

  await page.evaluate(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.querySelector<HTMLElement>("#root");
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (root) root.style.background = "transparent";
    if (!shell) throw new Error("App shell not found");
    shell.style.background = "transparent";
    for (const child of Array.from(shell.children)) {
      if (!child.classList.contains("flow-border")) {
        (child as HTMLElement).style.visibility = "hidden";
      }
    }
  });
  const fallbackOnly = PNG.sync.read(await page.screenshot({ omitBackground: true }));
  const centerAlpha = fallbackOnly.data[((Math.floor(fallbackOnly.height / 2) * fallbackOnly.width + Math.floor(fallbackOnly.width / 2)) * 4) + 3] ?? 255;
  const topCenterAlpha = fallbackOnly.data[(Math.floor(fallbackOnly.width / 2) * 4) + 3] ?? 0;
  expect(centerAlpha).toBeLessThan(16);
  expect(topCenterAlpha).toBeGreaterThan(16);
  expect(errors).toEqual([]);
  await context.close();
});

test("custom light theme has no large dark control surfaces", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1480, height: 840 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const scheme = JSON.parse(readFileSync(path.resolve("themes/muller-light.example.json"), "utf8")) as {
    flowBorder: { width: number; opacity: number; colors: Record<string, string> };
  };
  scheme.flowBorder.width = 5;
  scheme.flowBorder.opacity = 0.5;
  scheme.flowBorder.colors.idle = "#168f68";
  await page.locator(".theme-file-input").setInputFiles({
    name: "visual-light-theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(scheme)),
  });

  await page.keyboard.press("Control+2");
  await expect(page.locator(".scan-root-field")).toHaveCSS("background-color", "rgb(229, 233, 239)");
  await expect(page.locator(".scan-min-size")).toHaveCSS("background-color", "rgb(229, 233, 239)");
  await expect(page.locator("html")).toHaveCSS("--flow-border-width", "5px");
  expect(await findLargeDarkSurfaces(page)).toEqual([]);
  await page.screenshot({ path: path.join(artifactDirectory, "theme-light-duplicates.png"), fullPage: true });

  await page.keyboard.press("Control+3");
  await expect(page.locator(".compare-root-notice")).toBeVisible();
  expect(await findLargeDarkSurfaces(page)).toEqual([]);
  const buttonFinish = await page.locator(".compare-toolbar .compare-view-tabs button:enabled").first().evaluate((button) => ({
    borderRadius: window.getComputedStyle(button).borderRadius,
    boxShadow: window.getComputedStyle(button).boxShadow,
  }));
  expect(buttonFinish.borderRadius).toBe("6px");
  expect(buttonFinish.boxShadow).not.toBe("none");
  await page.screenshot({ path: path.join(artifactDirectory, "theme-light-compare.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("browser mode reports the desktop scanning boundary", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/");

  await page.keyboard.press("Control+2");
  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.locator(".scan-status")).toHaveText("Failed");
  await expect(page.locator(".scan-detail")).toHaveText(
    "Filesystem scanning requires the Muller desktop runtime",
  );
  await expect(page.getByRole("button", { name: "Cancel scan" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("browse and compare expose real pane controls and desktop boundaries", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await waitForWorkerFrames(page);

  await page.keyboard.press("Control+l");
  await expect(page.getByRole("combobox", { name: "Current directory" })).toHaveValue(
    "D:\\Muller",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".directory-pane")).toHaveCount(2);
  await expect(page.locator(".pane-error")).toHaveCount(2);
  await expect(page.locator(".pane-error").first()).toContainText(
    "Directory browsing requires the Muller desktop runtime",
  );

  const split = page.getByRole("button", { name: "Split view" });
  await expect(split).toHaveAttribute("aria-pressed", "true");
  await split.click();
  await expect(split).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".directory-pane:visible")).toHaveCount(1);
  await split.click();
  await expect(page.locator(".directory-pane:visible")).toHaveCount(2);

  await page.screenshot({
    path: path.join(artifactDirectory, "browse-browser.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: /Compare/ }).first().click();
  await page.keyboard.press("Control+l");
  await expect(page.getByRole("combobox", { name: "Current directory" })).toHaveValue("D:\\Muller");
  await page.keyboard.press("Escape");
  await expect(page.locator(".directory-pane")).toHaveCount(2);

  await expect(
    page.locator(".compare-toolbar").getByRole("button", { name: "Compare", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".compare-root-notice")).toContainText(
    "The left and right folders are the same",
  );

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    workspaceWidth: document.querySelector<HTMLElement>(".workspace")?.scrollWidth ?? 0,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.workspaceWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  await page.screenshot({
    path: path.join(artifactDirectory, "compare-browser.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("command mode, preview toggle, and hidden suspension are keyboard complete", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");
  await waitForWorkerFrames(page);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.screenshot({
    path: path.join(artifactDirectory, "stage6-command.png"),
    fullPage: true,
  });
  const search = page.getByRole("textbox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await search.fill("Compare");
  await search.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.locator(".compare-workspace")).toBeVisible();

  await page.keyboard.press("Control+1");
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.getByRole("complementary", { name: "File preview" })).toBeVisible();
  await expect(page.getByText("Select a file to preview")).toBeVisible();
  await page.screenshot({
    path: path.join(artifactDirectory, "stage6-preview.png"),
    fullPage: true,
  });
  await page.keyboard.press(" ");
  await expect(page.getByRole("complementary", { name: "File preview" })).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-app-suspended", "true");
  expect(errors).toEqual([]);
});

test("Stage 6.1 pane arrows and Ctrl+F stay inside Muller", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");
  await waitForWorkerFrames(page);

  const lists = page.locator(".directory-list-viewport");
  const panes = page.locator(".directory-pane");
  await lists.first().focus();
  await page.keyboard.press("Control+ArrowRight");
  await expect(panes.nth(1)).toHaveClass(/is-active/);
  await expect(lists.nth(1)).toBeFocused();
  await page.keyboard.press("Control+ArrowLeft");
  await expect(panes.first()).toHaveClass(/is-active/);
  await expect(lists.first()).toBeFocused();

  await page.keyboard.press("Control+f");
  const browseSearch = page.getByRole("textbox", { name: "Search current directory" });
  await expect(browseSearch).toBeFocused();
  await browseSearch.fill("src");
  await expect(browseSearch).toHaveValue("src");
  await browseSearch.press("Escape");
  await expect(browseSearch).toBeVisible();
  await expect(browseSearch).toHaveValue("");

  await page.keyboard.press("Control+3");
  await page.keyboard.press("Control+f");
  const compareSearch = page.getByRole("textbox", { name: "Search current directory" });
  await expect(compareSearch).toBeFocused();
  await compareSearch.fill("src");
  await expect(compareSearch).toHaveValue("src");
  await compareSearch.press("Escape");
  await expect(compareSearch).toHaveValue("");

  await page.keyboard.press("Control+2");
  await page.keyboard.press("Control+f");
  const duplicateSearch = page.getByRole("textbox", { name: "Search duplicate results" });
  await expect(duplicateSearch).toBeFocused();
  await duplicateSearch.fill("archive");
  await expect(duplicateSearch).toHaveValue("archive");
  await page.screenshot({
    path: path.join(artifactDirectory, "stage6-1-search.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
