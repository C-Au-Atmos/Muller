import { expect, test, type Page } from "@playwright/test";

async function installComparisonMock(page: Page, initialMode: "browse" | "compare" = "compare") {
  await page.addInitScript((initialMode) => {
    const callbacks = new Map<number, (message: unknown) => void>();
    let callbackId = 0;
    let nextId = 0;
    const queries = new Map<number, string>();
    const held = new Map<number, { onmessage: (message: unknown) => void }>();
    const state = { starts: 0, cancelled: [] as number[], closed: [] as number[], pages: [] as { filter: string; offset: number }[], hold: true, slowAdded: false, empty: false };
    const root = "D:\\CompareLeft";
    const tab = (id: string, mode: string, path: string) => ({ id, mode, path, title: path, virtualLocation: null, presentation: "list", filter: { extensions: [], date: null }, split: true, activePane: "left", scrollAnchors: { left: 0, right: 0 } });
    window.localStorage.setItem("muller.workspace.v3", JSON.stringify({ version: 3, tabs: [tab("compare-owner", initialMode, root), tab("other", "browse", "D:\\Other")], activeTabId: "compare-owner", paneRatio: 50, previewWidth: 320, inspectorWidth: 256, favorites: [] }));
    window.localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", motion: "reduced", audioEnabled: false }));
    const entries = Array.from({ length: 300 }, (_, index) => {
      const status = ["different", "right_only", "left_only", "metadata_only", "equal", "error"][index % 6];
      const relative_path = `item-${String(index).padStart(3, "0")}.txt`;
      return { relative_path, kind: "file", status, error: status === "error" ? "fixture read error" : null,
        left: status === "right_only" ? null : { path: `${root}\\${relative_path}`, size: 10, modified_unix_ms: 1000 },
        right: status === "left_only" ? null : { path: `D:\\CompareRight\\${relative_path}`, size: 10, modified_unix_ms: status === "metadata_only" ? 2000 : 1000 } };
    });
    const select = (filter: string) => entries.filter((entry) => filter === "all"
      || filter === "differences" && entry.status !== "equal"
      || filter === "different" && entry.status === "different"
      || filter === "added" && entry.status === "right_only"
      || filter === "deleted" && entry.status === "left_only"
      || filter === "time" && entry.status === "metadata_only"
      || filter === "same" && entry.status === "equal"
      || filter === "error" && entry.status === "error");
    const complete = () => {
      for (const [id, channel] of held) channel.onmessage({ type: "ready", taskId: id, sessionId: id, totalEntries: 300, issueCount: 0,
        stats: { total_entries: 300, different: 50, equal: 50, metadata_only: 50, left_only: 50, right_only: 50, errors: 50, hashed_files: 300, bytes_hashed: 3000 } });
      held.clear();
    };
    Object.assign(window, { __compareTest: { state, complete }, isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback(callback?: (message: unknown) => void) { const id = ++callbackId; if (callback) callbacks.set(id, callback); return id; },
        unregisterCallback(id: number) { callbacks.delete(id); },
        invoke(command: string, payload: { request?: { path?: string }; onEvent?: { onmessage: (message: unknown) => void }; sessionId?: number; taskId?: number; offset?: number; limit?: number; filter?: string; from?: number; direction?: number; query?: string }) {
          if (command === "plugin:window|is_maximized") return false;
          if (command === "get_shell_locations") return [{ id: "profile", label: "Profile", path: root }];
          if (command === "list_logical_drives" || command === "list_directory_extensions") return [];
          if (command === "start_directory_query") {
            const id = ++nextId;
            const path = payload.request?.path ?? root;
            queries.set(id, path);
            queueMicrotask(() => {
              payload.onEvent?.onmessage({ type: "started", taskId: id });
              payload.onEvent?.onmessage({ type: "ready", taskId: id, sessionId: id, path, parent: "D:\\", totalEntries: 2 });
            });
            return { taskId: id };
          }
          if (command === "read_directory_page" || command === "search_directory_page") {
            const path = queries.get(payload.sessionId ?? 0) ?? root;
            const entries = [
              { path: `${path}\\sample.txt`, name: "sample.txt", kind: "file", extension: "txt", size: 10, modifiedUnixMs: 1000, hidden: false },
              { path: "D:\\CompareRight", name: "CompareRight", kind: "directory", extension: null, size: 0, modifiedUnixMs: 1000, hidden: false },
            ].filter((entry) => command !== "search_directory_page" || entry.name.toLowerCase().includes((payload.query ?? "").toLowerCase()));
            return { sessionId: payload.sessionId, offset: 0, totalEntries: entries.length, entries };
          }
          if (command === "start_folder_diff") {
            const id = ++nextId;
            state.starts += 1;
            if (payload.onEvent) held.set(id, payload.onEvent);
            queueMicrotask(() => {
              payload.onEvent?.onmessage({ type: "started", taskId: id });
              payload.onEvent?.onmessage({ type: "progress", taskId: id, progress: { phase: "comparing", processed: 50, total: 300, bytes_hashed: 1000 } });
              if (!state.hold) complete();
            });
            return { taskId: id };
          }
          if (command === "read_folder_diff_page") {
            const filter = payload.filter ?? "all";
            const offset = payload.offset ?? 0;
            state.pages.push({ filter, offset });
            const filtered = state.empty ? [] : select(filter);
            const result = { sessionId: payload.sessionId, offset, totalEntries: filtered.length, entries: filtered.slice(offset, offset + (payload.limit ?? 128)) };
            return filter === "added" && state.slowAdded ? new Promise((resolve) => setTimeout(() => resolve(result), 300)) : result;
          }
          if (command === "find_diff_position") {
            const filtered = select(payload.filter ?? "all");
            const direction = payload.direction ?? 1;
            for (let position = (payload.from ?? 0) + direction; position >= 0 && position < filtered.length; position += direction) {
              if (filtered[position]?.status !== "equal") return position;
            }
            return null;
          }
          if (command === "cancel_diff") { state.cancelled.push(payload.taskId ?? 0); return { cancelled: true }; }
          if (command === "close_diff_session") { state.closed.push(payload.sessionId ?? 0); return true; }
          if (command === "read_text_preview") return { kind: "text", path: `${root}\\sample.txt`, text: "fixture preview", encoding: "utf8", lineEnding: "lf", truncated: false, size: 10 };
          if (command === "load_file_preview") return { kind: "unsupported", path: `${root}\\sample.txt`, size: 10 };
          return null;
        },
      },
    });
  }, initialMode);
}

type TestWindow = typeof window & { __compareTest: { state: { starts: number; cancelled: number[]; closed: number[]; pages: { filter: string; offset: number }[]; hold: boolean; slowAdded: boolean; empty: boolean }; complete: () => void } };
async function state(page: Page) { return page.evaluate(() => (window as TestWindow).__compareTest.state); }
async function startComparison(page: Page) {
  await page.goto("/");
  const workspace = page.locator(".compare-workspace:visible");
  await workspace.locator(".directory-pane").nth(1).getByText("CompareRight", { exact: true }).dblclick();
  await expect(workspace.locator(".directory-pane").nth(1).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\CompareRight");
  await workspace.locator(".compare-actions .is-primary").click();
  return workspace;
}

test("immediate compare search keeps focus across owner registration and repeated slow tool switches", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installComparisonMock(page, "browse");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto("/");
  await expect(page.locator(".browse-workspace:visible")).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search current directory", exact: true });
  const settleLayout = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  for (let owner = 0; owner < 2; owner += 1) {
    if (owner > 0) await page.locator(".workspace-tabs [role=tab]").nth(owner).click();
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await page.keyboard.press("Control+3");
      await page.keyboard.press("Control+f");
      await expect(search).toBeFocused();
      await settleLayout();
      await expect(search).toBeFocused();
      await page.keyboard.type("s");
      await expect(search).toHaveValue("s");
      await page.keyboard.press("Escape");
      await settleLayout();
      await expect(search).toHaveValue("");
      await expect(search).not.toBeFocused();

      await page.keyboard.press("Control+1");
      await page.keyboard.press("Control+f");
      await expect(search).toBeFocused();
      await settleLayout();
      await expect(search).toBeFocused();
      await page.keyboard.type("b");
      await expect(search).toHaveValue("b");
      await page.keyboard.press("Escape");
      await settleLayout();
      await expect(search).toHaveValue("");
      await expect(search).not.toBeFocused();
    }
  }
  await expect(page.locator(".compare-workspace")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("comparison continues across tools, settings and tabs, retaining paths/results/filter/selection and releasing closed owner", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installComparisonMock(page);
  const workspace = await startComparison(page);
  await expect(workspace.getByText("Comparing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(page.locator(".compare-workspace")).toBeHidden();
  await page.evaluate(() => (window as TestWindow).__compareTest.complete());
  expect((await state(page)).cancelled).toEqual([]);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(workspace.locator(".folder-diff-row:not(.is-placeholder)").first()).toContainText("item-000.txt");
  await workspace.getByRole("button", { name: "Added (right only)", exact: true }).click();
  await expect(workspace.locator(".folder-diff-row:not(.is-placeholder)").first()).toContainText("item-001.txt");
  await workspace.locator(".folder-diff-row").nth(2).click();
  const selected = await workspace.locator(".folder-diff-row[aria-selected=true]").getAttribute("title");
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await expect(page.locator(".compare-workspace")).toBeHidden();
  await page.locator(".workspace-tabs [role=tab]").first().click();
  await expect(workspace.getByRole("button", { name: "Added (right only)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(workspace.locator(".folder-diff-row[aria-selected=true]")).toHaveAttribute("title", selected!);
  await page.locator(".workspace-tabs [role=tab]").nth(1).click();
  await expect(page.locator(".browse-workspace:visible .directory-pane").first().locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\Other");
  await page.locator(".workspace-tabs [role=tab]").first().click();
  await workspace.getByRole("tab", { name: "Browse", exact: true }).click();
  await expect(workspace.locator(".directory-pane").nth(1).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\CompareRight");
  expect((await state(page)).starts).toBe(1);
  await page.locator(".workspace-tabs .workspace-tab__close").first().click();
  await expect(page.locator(".compare-workspace")).toHaveCount(0);
  await expect.poll(async () => (await state(page)).closed.length).toBe(1);
  expect(errors).toEqual([]);
});

test("folder filters use complete paged results, ignore late filter pages and reset selection/scroll", async ({ page }) => {
  await installComparisonMock(page);
  const workspace = await startComparison(page);
  await page.evaluate(() => (window as TestWindow).__compareTest.complete());
  const viewport = workspace.getByRole("grid", { name: "Folder comparison results" });
  await expect(viewport).toHaveAttribute("aria-rowcount", "300");
  await viewport.evaluate((element) => { element.scrollTop = 200 * 40; });
  await expect.poll(async () => (await state(page)).pages.some((page) => page.offset >= 128)).toBe(true);
  for (const [name, count, status] of [
    ["All differences", "250", ""], ["Content / type", "50", "different"], ["Added (right only)", "50", "right_only"],
    ["Deleted (left only)", "50", "left_only"], ["Time mismatch", "50", "metadata_only"], ["Same", "50", "equal"], ["Errors", "50", "error"],
  ]) {
    await workspace.getByRole("button", { name, exact: true }).click();
    await expect(viewport).toHaveAttribute("aria-rowcount", count);
    if (status) await expect(workspace.locator(".folder-diff-row:not(.is-placeholder)").first()).toHaveClass(new RegExp(`is-${status}`));
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  }
  await page.evaluate(() => { (window as TestWindow).__compareTest.state.slowAdded = true; });
  await workspace.getByRole("button", { name: "Added (right only)", exact: true }).click();
  await workspace.getByRole("button", { name: "Deleted (left only)", exact: true }).click();
  await expect(viewport).toHaveAttribute("aria-rowcount", "50");
  await page.waitForTimeout(350);
  await expect(workspace.locator(".folder-diff-row:not(.is-placeholder)").first()).toHaveClass(/is-left_only/);
  expect((await state(page)).starts).toBe(1);
  await page.screenshot({ path: "D:/Muller/release/0.1.5-qa/compare-filter.png" });
  await page.evaluate(() => { (window as TestWindow).__compareTest.state.empty = true; });
  await workspace.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(viewport).toHaveAttribute("aria-rowcount", "0");
  await expect(viewport.getByText("No comparison entries", { exact: true })).toBeVisible();
});

test("closing a running comparison cancels it and closes a late ready session", async ({ page }) => {
  await installComparisonMock(page);
  await startComparison(page);
  await page.locator(".workspace-tabs .workspace-tab__close").first().click();
  await expect(page.locator(".compare-workspace")).toHaveCount(0);
  await expect.poll(async () => (await state(page)).cancelled.length).toBe(1);
  await page.evaluate(() => (window as TestWindow).__compareTest.complete());
  await expect.poll(async () => (await state(page)).closed.length).toBe(1);
});

test("hidden compare browser cannot consume other browser keyboard or keep preview readers mounted", async ({ page }) => {
  await installComparisonMock(page);
  await page.goto("/");
  const workspace = page.locator(".compare-workspace");
  await workspace.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await expect(workspace.locator(".preview-panel")).toBeVisible();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(workspace.locator(".preview-panel")).toHaveCount(0);
  const currentBrowser = page.locator(".browse-workspace:visible");
  const viewport = currentBrowser.locator(".directory-list-viewport").first();
  await viewport.focus();
  await page.keyboard.press("Tab");
  await expect(currentBrowser.locator(".directory-pane").nth(1)).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(workspace.locator(".directory-pane").first()).toHaveClass(/is-active/);
  await expect(workspace.locator(".preview-panel")).toBeVisible();
});
