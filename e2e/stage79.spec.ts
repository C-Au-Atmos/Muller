import { expect, test, type Page } from "@playwright/test";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

interface MockPayload {
  input?: string;
  onEvent?: MockChannel;
  request?: { path?: string; filter?: { filesOnly?: boolean } };
  sessionId?: number;
  offset?: number;
}

interface DesktopMockOptions {
  holdScan?: boolean;
  directoryEntries?: boolean;
}

async function installDesktopMock(page: Page, options: DesktopMockOptions = {}): Promise<void> {
  await page.addInitScript(({ holdScan, withDirectoryEntries }) => {
    const runtime = globalThis as typeof globalThis & {
      isTauri: boolean;
      __mullerTestState: { directoryQueries: string[]; directoryFilesOnly: boolean[] };
    };
    const tauriWindow = window as unknown as {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: string } };
        transformCallback: (callback?: (message: unknown) => void) => number;
        unregisterCallback: (id: number) => void;
        invoke: (command: string, payload: MockPayload) => unknown;
      };
    };
    const callbacks = new Map<number, (message: unknown) => void>();
    let callbackId = 0;
    let taskId = 0;
    let sessionId = 0;
    runtime.isTauri = true;
    runtime.__mullerTestState = { directoryQueries: [], directoryFilesOnly: [] };

    const duplicateHash = "a".repeat(64);
    const duplicateGroup = {
      full_hash: duplicateHash,
      size: 4096,
      suggested_keep: 0,
      files: ["keep.png", "copy-one.png", "copy-two.png"].map((name, index) => ({
        path: `D:\\Pictures\\${name}`,
        size: 4096,
        created_unix_ms: 1_720_000_000_000 + index * 1000,
        modified_unix_ms: 1_710_000_000_000 + index * 1000,
        head_tail: "head-tail",
        full_hash: duplicateHash,
        hard_link_count: 1,
        locked: false,
      })),
    };
    const stats = {
      files_seen: 3,
      files_below_min_size: 0,
      unique_size_files: 0,
      size_candidate_files: 3,
      head_tail_candidate_files: 3,
      fully_hashed_files: 3,
      physical_duplicates_skipped: 0,
      blacklisted_entries_skipped: 0,
      symlinks_skipped: 0,
      bytes_read: 12_288,
    };

    tauriWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback(callback) {
        const id = ++callbackId;
        if (callback) callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") return false;
        if (command.startsWith("plugin:window|")) return null;
        if (command === "get_shell_locations") {
          return [{ id: "profile", label: "Profile", path: "D:\\Muller" }];
        }
        if (command === "list_directory_extensions") {
          return withDirectoryEntries ? [
            { extension: "png", count: 1 },
            { extension: "txt", count: 1 },
            { extension: "ts", count: 1 },
          ] : [];
        }
        if (command === "list_logical_drives") {
          return [{
            path: "E:\\",
            label: "Archive",
            fileSystem: "NTFS",
            driveType: "fixed",
            totalBytes: 1_000_000,
            freeBytes: 400_000,
          }];
        }
        if (command === "complete_directory_path") {
          const input = payload.input ?? "";
          if (input.includes("Alpha")) {
            return new Promise((resolve) => window.setTimeout(
              () => resolve(["D:\\Alpha-old"]),
              260,
            ));
          }
          if (input.includes("Beta")) {
            return new Promise((resolve) => window.setTimeout(
              () => resolve(["D:\\Beta"]),
              10,
            ));
          }
          if (input.startsWith("E:")) return ["E:\\Candidate"];
          return [];
        }
        if (command === "start_directory_query") {
          const nextTask = ++taskId;
          const nextSession = ++sessionId;
          const path = payload.request?.path ?? "D:\\Muller";
          runtime.__mullerTestState.directoryQueries.push(path);
          runtime.__mullerTestState.directoryFilesOnly.push(Boolean(payload.request?.filter?.filesOnly));
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTask });
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTask,
              sessionId: nextSession,
              path,
              parent: null,
              totalEntries: withDirectoryEntries ? 4 : 0,
            });
          });
          return { taskId: nextTask };
        }
        if (command === "read_directory_page") {
          const entries = withDirectoryEntries ? [
            { path: "D:\\Muller\\src", name: "src", kind: "directory", extension: null, size: 0, modifiedUnixMs: 1_720_000_000_000, hidden: false },
            { path: "D:\\Muller\\cover.png", name: "cover.png", kind: "file", extension: "png", size: 8192, modifiedUnixMs: 1_730_000_000_000, hidden: false },
            { path: "D:\\Muller\\notes.txt", name: "notes.txt", kind: "file", extension: "txt", size: 256, modifiedUnixMs: 1_710_000_000_000, hidden: false },
            { path: "D:\\Muller\\source.ts", name: "source.ts", kind: "file", extension: "ts", size: 1024, modifiedUnixMs: 1_740_000_000_000, hidden: false },
          ] : [];
          return {
            sessionId: payload.sessionId,
            offset: payload.offset ?? 0,
            totalEntries: entries.length,
            entries,
          };
        }
        if (command === "start_scan") {
          const nextTask = ++taskId;
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTask });
            if (!holdScan) {
              payload.onEvent?.onmessage({
                type: "groupFound",
                taskId: nextTask,
                groupIndex: 0,
                group: duplicateGroup,
              });
              payload.onEvent?.onmessage({
                type: "done",
                taskId: nextTask,
                groupCount: 1,
                groupOrder: [duplicateHash],
                reclaimableBytes: 8192,
                skipped: [],
                stats,
              });
            }
          });
          return { taskId: nextTask };
        }
        if (command === "cancel_scan") {
          return { taskId: payload.sessionId ?? 0, cancelled: true };
        }
        return null;
      },
    };
  }, {
    holdScan: options.holdScan ?? false,
    withDirectoryEntries: options.directoryEntries ?? false,
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
});

test("address Tab completion ignores stale responses and commits the current candidate", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.keyboard.press("Control+l");
  const address = page.getByRole("combobox", { name: "Current directory" });

  await address.fill("D:\\Alpha");
  await page.waitForTimeout(150);
  await address.fill("D:\\Beta");
  await expect(page.getByRole("option", { name: "D:\\Beta" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("option", { name: "D:\\Alpha-old" })).toHaveCount(0);

  await address.press("Tab");
  await expect(address).toHaveValue("D:\\Beta");
  await address.press("Enter");
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __mullerTestState: { directoryQueries: string[] };
    }
  ).__mullerTestState.directoryQueries)).toContain("D:\\Beta");
});

test("This PC lists real drives and opens a drive as a directory", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");

  await page.locator(".classic-tree-label", { hasText: "This PC" }).click();
  await expect(page.getByRole("region", { name: "This PC" })).toBeVisible();
  const drive = page.locator(".drive-item", { hasText: "Archive (E:)" });
  await expect(drive).toContainText("400.0 KB free of 1.0 MB");
  await drive.dblclick();

  await page.keyboard.press("Control+l");
  await expect(page.getByRole("combobox", { name: "Current directory" })).toHaveValue("E:\\");
  await page.waitForTimeout(150);
  await expect(page.locator("#address-completion-list")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Current directory" }).press("Enter");
  await page.waitForTimeout(150);
  await expect(page.locator(".breadcrumb-address").getByRole("button", { name: "This PC", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Up one level" }).click();
  await expect(page.getByRole("region", { name: "This PC" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __mullerTestState: { directoryQueries: string[] };
    }
  ).__mullerTestState.directoryQueries)).toContain("E:\\");
});

test("List columns and hover locator stay distinct", async ({ page }) => {
  await installDesktopMock(page, { directoryEntries: true });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Filmstrip" })).toHaveCount(0);
  const leftPane = page.locator(".directory-pane").first();
  const rows = leftPane.locator(".directory-row:not(.is-placeholder)");
  await expect(rows).toHaveCount(4);

  await rows.nth(1).hover();
  await expect(leftPane.locator(".directory-list-hover")).toBeVisible();
  await expect(leftPane.locator(".directory-list-selection")).toHaveCount(1);

  await page.getByRole("button", { name: "Choose list columns" }).click();
  const typeColumn = page.getByRole("menuitemcheckbox", { name: "Type" });
  await expect(typeColumn).toHaveAttribute("aria-checked", "false");
  await typeColumn.click();
  await expect(leftPane.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await leftPane.getByRole("columnheader", { name: "Modified" }).click();
  await expect(leftPane.getByRole("columnheader", { name: "Modified" })).toHaveAttribute("aria-sort", "ascending");

  await page.getByRole("button", { name: /Filters/ }).click();
  const pngOption = page.locator(".extension-option", { hasText: ".png" });
  await expect(pngOption).toBeVisible();
  const optionBox = await pngOption.boundingBox();
  expect(optionBox?.width ?? 0).toBeGreaterThan(100);
  expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(42);
  await expect(page.locator(".extension-actions .specular-button")).toHaveCount(2);
  await pngOption.click();
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __mullerTestState: { directoryFilesOnly: boolean[] };
    }
  ).__mullerTestState.directoryFilesOnly.at(-1))).toBe(true);
});

test("List drag marquee selects a contiguous range", async ({ page }) => {
  await installDesktopMock(page, { directoryEntries: true });
  await page.goto("/");

  const leftPane = page.locator(".directory-pane").first();
  const rows = leftPane.locator(".directory-row:not(.is-placeholder)");
  await expect(rows).toHaveCount(4);

  const second = await rows.nth(1).boundingBox();
  const last = await rows.nth(3).boundingBox();
  if (!second || !last) throw new Error("Directory row geometry is unavailable");
  await page.mouse.move(last.x + last.width * 0.5, last.y + last.height + 8);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.55, second.y + second.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(leftPane.locator(".selection-marquee")).toHaveCount(0);
  await expect(leftPane.locator(".directory-row.is-selected")).toHaveCount(3);

  await rows.nth(2).click({ button: "right" });
  const menu = page.getByRole("menu");
  const menuBox = await menu.boundingBox();
  const menuItemBox = await menu.getByRole("menuitem").first().boundingBox();
  const rowBox = await rows.nth(2).boundingBox();
  const viewportHeight = await page.evaluate(() => innerHeight);
  const menuBottom = (menuBox?.y ?? 0) + (menuBox?.height ?? 0);
  expect(menuBottom, JSON.stringify({ menuBox, viewportHeight })).toBeLessThanOrEqual(viewportHeight - 8);
  expect(menuItemBox?.height ?? 0).toBeGreaterThanOrEqual(rowBox?.height ?? 0);
});

test("Duplicate rows use direct keep/discard decisions and groups open a detail page", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.locator(".scan-status")).toHaveText("Complete");

  const files = page.locator(".duplicate-file-row");
  await expect(files).toHaveCount(3);
  const duplicateColors = await page.evaluate(() => {
    const file = document.querySelector<HTMLElement>(".duplicate-file-row");
    const group = document.querySelector<HTMLElement>(".duplicate-group-row");
    if (!file || !group) throw new Error("Duplicate color fixtures are missing");
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--duplicate-row-background)";
    document.body.append(probe);
    const rowToken = getComputedStyle(probe).backgroundColor;
    probe.style.backgroundColor = "var(--duplicate-group-background)";
    const groupToken = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { file: getComputedStyle(file).backgroundColor, group: getComputedStyle(group).backgroundColor, rowToken, groupToken };
  });
  expect(duplicateColors.file).toBe(duplicateColors.rowToken);
  expect(duplicateColors.group).toBe(duplicateColors.groupToken);
  await expect(files.nth(0)).toHaveCSS("border-top-style", "none");
  await expect(files.nth(0)).toHaveCSS("border-right-style", "none");
  await expect(files.nth(0)).toHaveCSS("border-left-style", "none");
  await expect(files.nth(0)).toHaveCSS("border-bottom-style", "solid");
  await files.nth(0).click();
  await expect(files.nth(0).locator(".decision-keep")).toHaveText("KEEP");
  await expect(files.nth(0)).toHaveCSS("outline-style", "none");
  await expect(files.nth(0).locator(".selection-surface")).not.toHaveCSS("border-color", "rgb(255, 255, 255)");
  await files.nth(1).click({ button: "right" });
  await expect(files.nth(1).locator(".decision-duplicate")).toHaveText("DUP");
  await files.nth(2).click({ button: "right" });
  await expect(files.nth(2).locator(".decision-duplicate")).toHaveText("DUP");

  await page.getByRole("button", { name: "Select confirmed DUP" }).click();
  await expect(page.locator(".duplicate-file-row.is-selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Review cleanup (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Review duplicate cleanup" });
  await expect(dialog).toContainText("D:\\Pictures\\copy-one.png");
  await expect(dialog).toContainText("D:\\Pictures\\copy-two.png");
  await dialog.getByRole("button", {
    name: "Remove D:\\Pictures\\copy-one.png from cleanup",
  }).click();
  await expect(dialog.getByRole("button", { name: "Move 1 to Recycle Bin" })).toBeVisible();
  await expect(dialog).not.toContainText("D:\\Pictures\\copy-one.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.locator(".duplicate-group-row").click();
  const detail = page.getByRole("region", { name: "Duplicate group 1 details" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("D:\\Pictures\\copy-one.png");
  const detailFiles = detail.locator(".duplicate-group-file");
  await detailFiles.nth(1).click();
  await expect(detailFiles.nth(1)).toHaveClass(/is-keep/);
  await detailFiles.nth(1).click({ button: "right" });
  await expect(detailFiles.nth(1)).toHaveClass(/is-discard/);
  await detail.getByRole("button", { name: "Back to duplicate groups" }).click();
  await expect(page.locator(".duplicate-file-row")).toHaveCount(3);
});

test("Flow Border returns to idle as soon as a running Duplicate scan leaves its owner view", async ({ page }) => {
  await installDesktopMock(page, { holdScan: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-flow-state", "scanning");

  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-flow-state", "idle");
});
