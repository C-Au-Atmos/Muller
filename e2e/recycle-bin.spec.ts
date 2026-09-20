import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RecycleBinEntry } from "../src/features/recycle-bin/recycleBinClient";

interface RecycleMock {
  entries: RecycleBinEntry[];
  calls: { command: string; request?: { ids: string[]; confirmed?: boolean } }[];
  failures: string[];
  cancelled: boolean;
  hold: boolean;
  release?: () => void;
  listError: boolean;
}
declare global { interface Window { __recycleTest: RecycleMock; } }
async function openRecycle(page: Page, count = 205) {
  await page.addInitScript(({ count }) => {
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ theme: "platinum", language: "en-US", soundsEnabled: false, motion: "reduced" }));
    const entries: RecycleBinEntry[] = Array.from({ length: count }, (_, index) => ({ id: `opaque-${index}`, name: `${index + 1} sample.${index % 5 === 0 ? "zip" : "txt"}`, originalPath: `D:\\Music\\Old\\${index + 1} sample.txt`, originalParent: index === 2 ? "D:\\Archive" : "D:\\Music\\Old", kind: index % 5 === 0 ? "folder" : "file", size: (index + 1) * 1024 * 1024, deletedMs: 1_790_000_000_000, typeLabel: index % 5 === 0 ? "File folder" : "Text document" }));
    const state: RecycleMock = { entries, calls: [], failures: [], cancelled: false, hold: false, listError: false }; window.__recycleTest = state;
    Object.assign(window, { isTauri: true }); let task = 0; let callback = 0;
    Object.assign(window, { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => undefined,
      invoke(command: string, payload: { sessionId?: number; offset?: number; request?: { ids?: string[]; confirmed?: boolean; path?: string }; onEvent?: { onmessage: (event: unknown) => void } }) {
        if (command === "plugin:window|is_maximized") return false;
        if (command === "get_shell_locations") return [{ id: "profile", label: "Profile", path: "D:\\Muller" }];
        if (command === "list_logical_drives" || command === "list_directory_extensions") return [];
        if (command === "start_directory_query") { const taskId = ++task; queueMicrotask(() => { payload.onEvent?.onmessage({ type: "started", taskId }); payload.onEvent?.onmessage({ type: "ready", taskId, sessionId: taskId, path: payload.request?.path ?? "D:\\Muller", parent: null, totalEntries: 0 }); }); return { taskId }; }
        if (command === "read_directory_page") return { sessionId: payload.sessionId, offset: payload.offset ?? 0, totalEntries: 0, entries: [] };
        if (command === "list_recycle_bin") { state.calls.push({ command }); if (state.listError) throw new Error("Shell is unavailable"); return { entries: [...state.entries], totalCount: state.entries.length, totalBytes: state.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) }; }
        if (command === "restore_recycle_bin_items" || command === "delete_recycle_bin_items") {
          const request = { ids: payload.request?.ids ?? [], confirmed: payload.request?.confirmed }; state.calls.push({ command, request });
          const complete = () => {
            const succeededIds = request.ids.filter((id) => !state.cancelled && !state.failures.includes(id));
            state.entries = state.entries.filter((entry) => !succeededIds.includes(entry.id));
            return { succeededIds, failures: request.ids.filter((id) => state.failures.includes(id)).map((id) => ({ id, message: "Access denied" })), cancelled: state.cancelled };
          };
          if (state.hold) return new Promise((resolve) => { state.release = () => resolve(complete()); });
          return complete();
        }
        if (command === "recycle_items") state.calls.push({ command });
        return null;
      },
    } });
  }, { count });
  await page.goto("/");
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click();
  const region = page.getByRole("region", { name: "Recycle Bin", exact: true });
  await expect(region).toBeVisible();
  await expect(region.getByRole("grid")).toHaveAttribute("aria-busy", "false");
  return region;
}
const operationCalls = (page: Page) => page.evaluate(() => window.__recycleTest.calls.filter((call) => call.command.endsWith("recycle_bin_items")));

test("Recycle Bin paginates naturally sorted items and selects across pages with keyboard isolation", async ({ page }) => {
  const region = await openRecycle(page);
  const rows = region.locator(".recycle-bin__row"); const list = region.locator(".recycle-bin__list");
  await expect(rows).toHaveCount(100); await expect(list).toBeFocused();
  await expect(rows.first()).toContainText("1 sample.zip");
  await expect(rows.nth(1)).toContainText("2 sample.txt");
  await list.press("ArrowDown"); await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await list.press("Shift+PageDown");
  await expect(region.locator(".recycle-bin__footer")).toContainText("101 selected");
  await expect(rows.first()).toContainText("101 sample.zip");
  await list.press("Control+a"); await expect(region.locator(".recycle-bin__footer")).toContainText("205 selected");
  await list.press("Control+f"); const search = region.getByRole("searchbox"); await expect(search).toBeFocused();
  await search.fill("Archive"); await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText("3 sample.txt");
  await search.press("Control+a"); await search.press("Delete");
  await expect(region.getByRole("dialog")).toHaveCount(0); expect(await operationCalls(page)).toHaveLength(0);
  await search.fill("3 sample"); await list.focus();
  await list.dispatchEvent("keydown", { key: "Delete", isComposing: true, bubbles: true });
  await expect(region.getByRole("dialog")).toHaveCount(0);
  await list.press("F5"); await expect.poll(() => page.evaluate(() => window.__recycleTest.calls.filter((call) => call.command === "list_recycle_bin").length)).toBe(2);
});

test("Restore selected sends only opaque selected IDs and keeps failed items visible", async ({ page }) => {
  const region = await openRecycle(page, 4); const rows = region.locator(".recycle-bin__row");
  await rows.nth(0).click(); await rows.nth(1).click({ modifiers: ["Control"] });
  await page.evaluate(() => { window.__recycleTest.failures = ["opaque-1"]; });
  await region.getByRole("button", { name: "Restore selected", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("2 sample.txt: Access denied");
  await expect(rows).toHaveCount(3); await expect(region.locator('[data-id="opaque-1"]')).toHaveAttribute("aria-selected", "true");
  expect(await operationCalls(page)).toEqual([{ command: "restore_recycle_bin_items", request: { ids: ["opaque-0", "opaque-1"] } }]);
  await expect(region.locator('[data-id="opaque-0"]')).toHaveCount(0);
});

test("Delete and context menu require explicit confirmation and preserve Windows cancellation", async ({ page }) => {
  const region = await openRecycle(page, 3); const row = region.locator('[data-id="opaque-1"]');
  await row.click({ button: "right" }); const menu = region.getByRole("menu"); await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Restore selected" }).press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delete permanently" })).toBeFocused();
  await menu.getByRole("menuitem", { name: "Delete permanently" }).click();
  const dialog = region.getByRole("dialog"); await expect(dialog).toContainText("2 sample.txt");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click(); expect(await operationCalls(page)).toHaveLength(0);
  await region.locator(".recycle-bin__list").press("Delete");
  await page.evaluate(() => { window.__recycleTest.cancelled = true; });
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(row).toBeVisible(); await expect(region.locator(".recycle-bin__notice")).toContainText("cancelled");
  expect(await operationCalls(page)).toEqual([{ command: "delete_recycle_bin_items", request: { ids: ["opaque-1"], confirmed: true } }]);
  expect(await page.evaluate(() => window.__recycleTest.calls.filter((call) => call.command === "recycle_items"))).toEqual([]);
});

test("Empty Recycle Bin confirms all enumerated IDs across filters and pages and prevents reentry", async ({ page }) => {
  const region = await openRecycle(page); await region.getByRole("searchbox").fill("Archive");
  await region.getByRole("button", { name: "Empty Recycle Bin" }).click(); const dialog = region.getByRole("dialog");
  await expect(dialog).toContainText("205 items"); await expect(dialog).toContainText("other pages");
  await dialog.getByRole("button", { name: "Cancel" }).press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Delete permanently" })).toBeFocused();
  await page.evaluate(() => { window.__recycleTest.hold = true; });
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(region.getByRole("button", { name: "Empty Recycle Bin" })).toBeDisabled();
  await region.locator(".recycle-bin__list").focus(); await region.locator(".recycle-bin__list").press("Delete");
  await expect(region.getByRole("dialog")).toHaveCount(0); expect(await operationCalls(page)).toHaveLength(1);
  await page.evaluate(() => window.__recycleTest.release?.());
  await expect(region.locator(".recycle-bin__row")).toHaveCount(0);
  expect((await operationCalls(page))[0].request!.ids).toHaveLength(205);
});

test("Restore all includes filtered and paginated entries and refresh errors remain visible", async ({ page }) => {
  const region = await openRecycle(page); await region.getByRole("searchbox").fill("Archive");
  await region.getByRole("button", { name: "Restore all", exact: true }).click();
  await region.getByRole("dialog").getByRole("button", { name: "Restore all" }).click();
  await expect(region.locator(".recycle-bin__row")).toHaveCount(0);
  const calls = await operationCalls(page); expect(calls[0].command).toBe("restore_recycle_bin_items"); expect(calls[0].request!.ids).toHaveLength(205);
  await page.evaluate(() => { window.__recycleTest.listError = true; }); await region.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("Shell is unavailable");
});

test("Recycle Bin routes independently through Home, Settings and Browse", async ({ page }) => {
  const region = await openRecycle(page, 3);
  await page.getByRole("button", { name: "Home", exact: true }).click(); await expect(region).toHaveCount(0);
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click(); await expect(region).toBeVisible();
  await page.getByRole("button", { name: "Open settings", exact: true }).click(); await expect(region).toHaveCount(0);
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click(); await expect(region).toBeVisible();
  await page.getByRole("button", { name: "Browse", exact: true }).click(); await expect(region).toHaveCount(0);
  await expect(page.locator(".directory-list-viewport").first()).toBeVisible();
  expect(await operationCalls(page)).toHaveLength(0);
});

test("Platinum Recycle Bin has clear selection geometry and bounded confirmation at narrow widths", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 940 }); const region = await openRecycle(page, 12);
  const row = region.locator(".recycle-bin__row").first(); await row.click();
  const geometry = await row.evaluate((element) => {
    const row = element.getBoundingClientRect(); const name = element.querySelector(".recycle-bin__name")!.getBoundingClientRect(); const size = element.querySelector(".recycle-bin__size")!;
    return { nameInset: name.left - row.left, sizePadding: parseFloat(getComputedStyle(size).paddingRight), foreground: getComputedStyle(element.querySelector(".recycle-bin__name")!).color, selectedBorder: getComputedStyle(element, "::before").borderColor };
  });
  expect(geometry.nameInset).toBeGreaterThanOrEqual(12); expect(geometry.sizePadding).toBeGreaterThanOrEqual(8); expect(geometry.selectedBorder).not.toBe("rgba(0, 0, 0, 0)");
  const artifacts = process.env.MULLER_QA_ARTIFACT_DIR ?? test.info().outputPath("artifacts");
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, "recycle-bin-platinum.png") });
  await region.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await page.screenshot({ path: join(artifacts, "recycle-bin-confirmation.png") });
  await region.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.setViewportSize({ width: 900, height: 700 }); await row.click({ button: "right" });
  const frame = await region.boundingBox(); const menu = await region.getByRole("menu").boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(frame!.x); expect(menu!.x + menu!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
  expect(errors).toEqual([]);
});
