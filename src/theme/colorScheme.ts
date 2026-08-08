export const THEME_COLOR_KEYS = [
  "canvas",
  "panel",
  "raised",
  "overlay",
  "chrome",
  "toolbar",
  "sidebar",
  "workspace",
  "row",
  "rowHover",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "border",
  "borderSubtle",
  "borderStrong",
  "accent",
  "accentSoft",
  "success",
  "successSoft",
  "warning",
  "warningSoft",
  "danger",
  "dangerSoft",
  "info",
  "infoSoft",
  "scrollbarThumb",
  "scrollbarTrack",
  "folder",
  "duplicateGroup",
  "duplicateGroupHover",
  "duplicateRow",
  "duplicateRowHover",
  "diffAddBackground",
  "diffAddMark",
  "diffDeleteBackground",
  "diffDeleteMark",
  "diffChangeBackground",
  "diffChangeMark",
] as const;

export type ThemeColorKey = typeof THEME_COLOR_KEYS[number];

export const FLOW_BORDER_COLOR_KEYS = [
  "background",
  "highlight",
  "idle",
  "scanning",
  "success",
  "danger",
] as const;

export type FlowBorderColorKey = typeof FLOW_BORDER_COLOR_KEYS[number];

export interface ThemeFlowBorder {
  enabled: boolean;
  width: number;
  opacity: number;
  colors: Record<FlowBorderColorKey, string>;
}

export interface ThemeColorScheme {
  schemaVersion: 1;
  name: string;
  mode: "dark" | "light";
  colors: Record<ThemeColorKey, string>;
  flowBorder: ThemeFlowBorder;
}

const CSS_VARIABLES: Record<ThemeColorKey, string> = {
  canvas: "--surface-0",
  panel: "--surface-1",
  raised: "--surface-2",
  overlay: "--surface-overlay",
  chrome: "--surface-chrome",
  toolbar: "--surface-toolbar",
  sidebar: "--surface-sidebar",
  workspace: "--surface-workspace",
  row: "--surface-row",
  rowHover: "--surface-row-hover",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  border: "--border",
  borderSubtle: "--border-subtle",
  borderStrong: "--border-strong",
  accent: "--accent",
  accentSoft: "--accent-soft",
  success: "--success",
  successSoft: "--success-soft",
  warning: "--warning",
  warningSoft: "--warning-soft",
  danger: "--danger",
  dangerSoft: "--danger-soft",
  info: "--info",
  infoSoft: "--info-soft",
  scrollbarThumb: "--scrollbar-thumb",
  scrollbarTrack: "--scrollbar-track",
  folder: "--folder-color",
  duplicateGroup: "--duplicate-group-background",
  duplicateGroupHover: "--duplicate-group-hover",
  duplicateRow: "--duplicate-row-background",
  duplicateRowHover: "--duplicate-row-hover",
  diffAddBackground: "--diff-add-bg",
  diffAddMark: "--diff-add-mark",
  diffDeleteBackground: "--diff-delete-bg",
  diffDeleteMark: "--diff-delete-mark",
  diffChangeBackground: "--diff-change-bg",
  diffChangeMark: "--diff-change-mark",
};

const FLOW_BORDER_CSS_VARIABLES: Record<FlowBorderColorKey, string> = {
  background: "--flow-border-background",
  highlight: "--flow-border-highlight",
  idle: "--flow-border-idle",
  scanning: "--flow-border-scanning",
  success: "--flow-border-success",
  danger: "--flow-border-danger",
};

export const THEME_COLOR_USAGE: Record<ThemeColorKey, string> = {
  canvas: "应用最底层背景",
  panel: "目录、预览、结果等主面板",
  raised: "按钮、输入框和抬升控件",
  overlay: "菜单、对话框和浮层",
  chrome: "顶部标签栏和地址栏",
  toolbar: "功能栏和文件操作栏",
  sidebar: "左侧位置导航栏",
  workspace: "主工作区底色",
  row: "普通文件行",
  rowHover: "文件行悬停",
  textPrimary: "主要文字",
  textSecondary: "次要文字",
  textMuted: "说明、时间和弱化文字",
  border: "普通边框",
  borderSubtle: "分隔线和弱边框",
  borderStrong: "弹窗、输入框和强调边框",
  accent: "主强调色和选择框",
  accentSoft: "强调色浅背景",
  success: "保留、成功和可用状态",
  successSoft: "成功状态浅背景",
  warning: "警告状态",
  warningSoft: "警告状态浅背景",
  danger: "弃置、删除和错误状态",
  dangerSoft: "危险状态浅背景",
  info: "信息、键盘焦点和链接",
  infoSoft: "信息状态浅背景",
  scrollbarThumb: "滚动条滑块",
  scrollbarTrack: "滚动条轨道",
  folder: "文件夹图标",
  duplicateGroup: "重复文件组标题行",
  duplicateGroupHover: "重复文件组标题悬停",
  duplicateRow: "重复文件普通行",
  duplicateRowHover: "重复文件行悬停",
  diffAddBackground: "比较结果新增背景",
  diffAddMark: "比较结果新增标记",
  diffDeleteBackground: "比较结果删除背景",
  diffDeleteMark: "比较结果删除标记",
  diffChangeBackground: "比较结果变更背景",
  diffChangeMark: "比较结果变更标记",
};

export const FLOW_BORDER_USAGE = {
  enabled: "是否显示应用窗口外框",
  width: "外框宽度，范围 1-8 像素",
  opacity: "外框透明度，范围 0-1",
  colors: {
    background: "外框未发光区域的底色",
    highlight: "流动光段的高光色",
    idle: "空闲状态颜色",
    scanning: "扫描状态颜色",
    success: "成功状态颜色",
    danger: "错误或危险状态颜色",
  },
} as const;

export const DEFAULT_DARK_COLOR_SCHEME: ThemeColorScheme = {
  schemaVersion: 1,
  name: "Muller Dark",
  mode: "dark",
  colors: {
    canvas: "#100c17",
    panel: "#171020",
    raised: "#21172d",
    overlay: "rgba(23, 16, 32, 0.97)",
    chrome: "rgba(27, 23, 34, 0.94)",
    toolbar: "rgba(27, 23, 34, 0.94)",
    sidebar: "rgba(27, 23, 34, 0.84)",
    workspace: "rgba(27, 23, 34, 0.78)",
    row: "rgba(23, 16, 32, 0.72)",
    rowHover: "#21172d",
    textPrimary: "#f7f4fa",
    textSecondary: "#d2cadb",
    textMuted: "#9b91a5",
    border: "#473b52",
    borderSubtle: "rgba(120, 108, 132, 0.32)",
    borderStrong: "rgba(141, 128, 153, 0.62)",
    accent: "#b978f2",
    accentSoft: "rgba(185, 120, 242, 0.14)",
    success: "#55b87a",
    successSoft: "rgba(85, 184, 122, 0.14)",
    warning: "#d7aa58",
    warningSoft: "rgba(215, 170, 88, 0.14)",
    danger: "#e16b78",
    dangerSoft: "rgba(225, 107, 120, 0.14)",
    info: "#6da8e8",
    infoSoft: "rgba(109, 168, 232, 0.14)",
    scrollbarThumb: "#473b52",
    scrollbarTrack: "#100c17",
    folder: "#e6b85c",
    duplicateGroup: "#171020",
    duplicateGroupHover: "#21172d",
    duplicateRow: "#100c17",
    duplicateRowHover: "#21172d",
    diffAddBackground: "rgba(54, 128, 79, 0.19)",
    diffAddMark: "rgba(74, 171, 107, 0.36)",
    diffDeleteBackground: "rgba(157, 60, 71, 0.19)",
    diffDeleteMark: "rgba(204, 82, 95, 0.38)",
    diffChangeBackground: "rgba(183, 130, 43, 0.18)",
    diffChangeMark: "rgba(215, 170, 88, 0.36)",
  },
  flowBorder: {
    enabled: true,
    width: 3,
    opacity: 0.82,
    colors: {
      background: "#171020",
      highlight: "#f7f4fa",
      idle: "#b978f2",
      scanning: "#6da8e8",
      success: "#55b87a",
      danger: "#e16b78",
    },
  },
};

export const DEFAULT_LIGHT_COLOR_SCHEME: ThemeColorScheme = {
  schemaVersion: 1,
  name: "Muller Neutral Light",
  mode: "light",
  colors: {
    canvas: "#dfe3e8",
    panel: "#f4f6f8",
    raised: "#e5e9ef",
    overlay: "rgba(250, 251, 252, 0.98)",
    chrome: "#e4e7ec",
    toolbar: "#edf0f4",
    sidebar: "#e8ebef",
    workspace: "#eef1f4",
    row: "#f6f7f9",
    rowHover: "#e5eaf0",
    textPrimary: "#20242a",
    textSecondary: "#4c535d",
    textMuted: "#737b86",
    border: "#bcc3cc",
    borderSubtle: "rgba(82, 92, 104, 0.22)",
    borderStrong: "rgba(66, 76, 88, 0.48)",
    accent: "#6f4a91",
    accentSoft: "rgba(111, 74, 145, 0.12)",
    success: "#277a46",
    successSoft: "rgba(39, 122, 70, 0.12)",
    warning: "#875a08",
    warningSoft: "rgba(135, 90, 8, 0.12)",
    danger: "#a52e3b",
    dangerSoft: "rgba(165, 46, 59, 0.12)",
    info: "#2468a2",
    infoSoft: "rgba(36, 104, 162, 0.12)",
    scrollbarThumb: "#89919c",
    scrollbarTrack: "#dfe3e8",
    folder: "#a66c00",
    duplicateGroup: "#e4e8ed",
    duplicateGroupHover: "#d8dee6",
    duplicateRow: "#f4f6f8",
    duplicateRowHover: "#e5eaf0",
    diffAddBackground: "rgba(46, 139, 77, 0.13)",
    diffAddMark: "rgba(46, 139, 77, 0.27)",
    diffDeleteBackground: "rgba(181, 57, 71, 0.12)",
    diffDeleteMark: "rgba(181, 57, 71, 0.26)",
    diffChangeBackground: "rgba(159, 105, 15, 0.13)",
    diffChangeMark: "rgba(159, 105, 15, 0.27)",
  },
  flowBorder: {
    enabled: true,
    width: 3,
    opacity: 0.68,
    colors: {
      background: "#dfe3e8",
      highlight: "#ffffff",
      idle: "#6f4a91",
      scanning: "#2468a2",
      success: "#277a46",
      danger: "#a52e3b",
    },
  },
};

export const MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME: ThemeColorScheme = {
  schemaVersion: 1,
  name: "Muller Monochrome Platinum",
  mode: "dark",
  colors: {
    canvas: "#09090b",
    panel: "#121215",
    raised: "#27272a",
    overlay: "rgba(24, 24, 27, 0.98)",
    chrome: "#0f0f11",
    toolbar: "#151518",
    sidebar: "#0f0f11",
    workspace: "#121215",
    row: "#151518",
    rowHover: "#242428",
    textPrimary: "#fafafa",
    textSecondary: "#a1a1aa",
    textMuted: "#66666e",
    border: "#2f2f35",
    borderSubtle: "rgba(255, 255, 255, 0.12)",
    borderStrong: "rgba(255, 255, 255, 0.45)",
    accent: "#ffffff",
    accentSoft: "rgba(255, 255, 255, 0.12)",
    success: "#3fc070",
    successSoft: "rgba(255, 255, 255, 0.08)",
    warning: "#eab308",
    warningSoft: "rgba(255, 255, 255, 0.08)",
    danger: "#f43f5e",
    dangerSoft: "rgba(255, 255, 255, 0.08)",
    info: "#38bdf8",
    infoSoft: "rgba(255, 255, 255, 0.08)",
    scrollbarThumb: "#3f3f46",
    scrollbarTrack: "#121215",
    folder: "#e4e4e7",
    duplicateGroup: "#1d1d21",
    duplicateGroupHover: "#28282d",
    duplicateRow: "#151518",
    duplicateRowHover: "#242428",
    diffAddBackground: "rgba(74, 222, 128, 0.12)",
    diffAddMark: "rgba(74, 222, 128, 0.30)",
    diffDeleteBackground: "rgba(244, 63, 94, 0.12)",
    diffDeleteMark: "rgba(244, 63, 94, 0.30)",
    diffChangeBackground: "rgba(250, 204, 21, 0.12)",
    diffChangeMark: "rgba(250, 204, 21, 0.30)",
  },
  flowBorder: {
    enabled: true,
    width: 3,
    opacity: 0.88,
    colors: {
      background: "#141418",
      highlight: "#ffffff",
      idle: "#e4e4e7",
      scanning: "#cbd5e1",
      success: "#a7f3d0",
      danger: "#fecdd3",
    },
  },
};

const SAFE_COLOR = /^(?:transparent|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([-0-9a-z.% ,/+]+\))$/i;

export function parseThemeColorScheme(value: unknown): ThemeColorScheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > 80) return null;
  if (raw.mode !== "dark" && raw.mode !== "light") return null;
  if (!raw.colors || typeof raw.colors !== "object" || Array.isArray(raw.colors)) return null;
  const rawColors = raw.colors as Record<string, unknown>;
  const known = new Set<string>(THEME_COLOR_KEYS);
  if (Object.keys(rawColors).some((key) => !known.has(key))) return null;
  const colors = {} as Record<ThemeColorKey, string>;
  for (const key of THEME_COLOR_KEYS) {
    const color = rawColors[key];
    if (typeof color !== "string" || !SAFE_COLOR.test(color.trim())) return null;
    colors[key] = color.trim();
  }
  const fallbackFlowBorder = raw.mode === "light"
    ? DEFAULT_LIGHT_COLOR_SCHEME.flowBorder
    : DEFAULT_DARK_COLOR_SCHEME.flowBorder;
  let flowBorder: ThemeFlowBorder;
  if (raw.flowBorder === undefined) {
    flowBorder = {
      ...fallbackFlowBorder,
      colors: { ...fallbackFlowBorder.colors },
    };
  } else {
    if (!raw.flowBorder || typeof raw.flowBorder !== "object" || Array.isArray(raw.flowBorder)) return null;
    const rawFlowBorder = raw.flowBorder as Record<string, unknown>;
    const knownFlowKeys = new Set(["enabled", "width", "opacity", "colors"]);
    if (Object.keys(rawFlowBorder).some((key) => !knownFlowKeys.has(key))) return null;
    if (typeof rawFlowBorder.enabled !== "boolean") return null;
    if (typeof rawFlowBorder.width !== "number" || !Number.isFinite(rawFlowBorder.width) || rawFlowBorder.width < 1 || rawFlowBorder.width > 8) return null;
    if (typeof rawFlowBorder.opacity !== "number" || !Number.isFinite(rawFlowBorder.opacity) || rawFlowBorder.opacity < 0 || rawFlowBorder.opacity > 1) return null;
    if (!rawFlowBorder.colors || typeof rawFlowBorder.colors !== "object" || Array.isArray(rawFlowBorder.colors)) return null;
    const rawFlowColors = rawFlowBorder.colors as Record<string, unknown>;
    const knownFlowColors = new Set<string>(FLOW_BORDER_COLOR_KEYS);
    if (Object.keys(rawFlowColors).some((key) => !knownFlowColors.has(key))) return null;
    const flowColors = {} as Record<FlowBorderColorKey, string>;
    for (const key of FLOW_BORDER_COLOR_KEYS) {
      const color = rawFlowColors[key];
      if (typeof color !== "string" || !SAFE_COLOR.test(color.trim())) return null;
      flowColors[key] = color.trim();
    }
    flowBorder = {
      enabled: rawFlowBorder.enabled,
      width: rawFlowBorder.width,
      opacity: rawFlowBorder.opacity,
      colors: flowColors,
    };
  }
  return { schemaVersion: 1, name: raw.name.trim(), mode: raw.mode, colors, flowBorder };
}

export function applyThemeColorScheme(root: HTMLElement, scheme: ThemeColorScheme | null): void {
  for (const key of THEME_COLOR_KEYS) {
    const variable = CSS_VARIABLES[key];
    if (scheme) root.style.setProperty(variable, scheme.colors[key]);
    else root.style.removeProperty(variable);
  }
  for (const key of FLOW_BORDER_COLOR_KEYS) {
    const variable = FLOW_BORDER_CSS_VARIABLES[key];
    if (scheme) root.style.setProperty(variable, scheme.flowBorder.colors[key]);
    else root.style.removeProperty(variable);
  }
  if (scheme) {
    root.style.setProperty("--flow-border-enabled", scheme.flowBorder.enabled ? "1" : "0");
    root.style.setProperty("--flow-border-visibility", scheme.flowBorder.enabled ? "visible" : "hidden");
    root.style.setProperty("--flow-border-width", `${scheme.flowBorder.width}px`);
    root.style.setProperty("--flow-border-opacity", String(scheme.flowBorder.opacity));
  } else {
    root.style.removeProperty("--flow-border-enabled");
    root.style.removeProperty("--flow-border-visibility");
    root.style.removeProperty("--flow-border-width");
    root.style.removeProperty("--flow-border-opacity");
  }
}

export function serializeThemeColorScheme(scheme: ThemeColorScheme): string {
  return `${JSON.stringify({ ...scheme, usage: THEME_COLOR_USAGE, flowBorderUsage: FLOW_BORDER_USAGE }, null, 2)}\n`;
}
