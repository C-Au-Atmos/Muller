import { describe, expect, it } from "vitest";

import { resolveAppCommand } from "./appCommands";

describe("application keymap", () => {
  it("maps tool and cancellation commands", () => {
    expect(resolveAppCommand({ key: "k", ctrlKey: true })).toBe("openCommandPalette");
    expect(resolveAppCommand({ key: "f", ctrlKey: true })).toBe("findInDirectory");
    expect(resolveAppCommand({ key: "1", ctrlKey: true })).toBe("openBrowse");
    expect(resolveAppCommand({ key: "2", ctrlKey: true })).toBe("openDuplicates");
    expect(resolveAppCommand({ key: "3", ctrlKey: true })).toBe("openCompare");
    expect(resolveAppCommand({ key: ",", ctrlKey: true })).toBe("openSettings");
    expect(resolveAppCommand({ key: "t", ctrlKey: true })).toBe("newTab");
    expect(resolveAppCommand({ key: "l", ctrlKey: true })).toBe("editAddress");
    expect(resolveAppCommand({ key: "Escape" })).toBe("cancelScan");
  });

  it("does not resolve application commands while an IME owns the key event", () => {
    expect(resolveAppCommand({ key: "Enter", isComposing: true })).toBeNull();
    expect(resolveAppCommand({ key: "Escape", isComposing: true })).toBeNull();
    expect(resolveAppCommand({ key: "Escape", keyCode: 229 })).toBeNull();
    expect(resolveAppCommand({ key: "ArrowDown", keyCode: 229 })).toBeNull();
    expect(resolveAppCommand({ key: "f", ctrlKey: true, keyCode: 229 })).toBeNull();
  });

  it("maps list navigation without stealing modified arrows", () => {
    expect(resolveAppCommand({ key: "ArrowDown" })).toBe("moveNext");
    expect(resolveAppCommand({ key: "ArrowLeft" })).toBe("moveLeft");
    expect(resolveAppCommand({ key: "ArrowRight" })).toBe("moveRight");
    expect(resolveAppCommand({ key: "ArrowLeft", ctrlKey: true })).toBe("activateLeftPane");
    expect(resolveAppCommand({ key: "ArrowRight", ctrlKey: true })).toBe("activateRightPane");
    expect(resolveAppCommand({ key: "ArrowLeft", altKey: true })).toBe("goBack");
    expect(resolveAppCommand({ key: "ArrowRight", altKey: true })).toBe("goForward");
    expect(resolveAppCommand({ key: "PageUp" })).toBe("movePagePrevious");
    expect(resolveAppCommand({ key: "ArrowDown", ctrlKey: true })).toBeNull();
    expect(resolveAppCommand({ key: "ArrowDown", altKey: true })).toBe("nextDifference");
  });

  it("maps standard file-manager commands", () => {
    expect(resolveAppCommand({ key: "C", ctrlKey: true })).toBe("copySelection");
    expect(resolveAppCommand({ key: "x", ctrlKey: true })).toBe("cutSelection");
    expect(resolveAppCommand({ key: "v", ctrlKey: true })).toBe("paste");
    expect(resolveAppCommand({ key: "F2" })).toBe("renameSelection");
    expect(resolveAppCommand({ key: "Delete" })).toBe("recycleSelection");
    expect(resolveAppCommand({ key: "Backspace" })).toBe("goUp");
    expect(resolveAppCommand({ key: "F5" })).toBe("refresh");
    expect(resolveAppCommand({ key: " " })).toBe("togglePreview");
    expect(resolveAppCommand({ key: "a", ctrlKey: true })).toBe("selectAll");
    expect(resolveAppCommand({ key: "z", ctrlKey: true })).toBe("undo");
  });
});
