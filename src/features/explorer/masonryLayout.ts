export interface MasonryItem {
  position: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryLayout {
  items: MasonryItem[];
  columns: MasonryItem[][];
  columnHeights: number[];
  height: number;
}

export type VisualDirection = "up" | "down" | "left" | "right";

function itemHeight(position: number, width: number): number {
  const hash = Math.imul(position + 1, 2_654_435_761) >>> 0;
  const ratio = 0.78 + (hash % 83) / 100;
  return Math.round(width * ratio) + 45;
}

export function buildMasonryLayout(
  count: number,
  columnCount: number,
  availableWidth: number,
  gap = 10,
): MasonryLayout {
  const columns = Math.max(1, Math.floor(columnCount));
  const columnWidth = Math.max(110, (availableWidth - gap * (columns - 1)) / columns);
  const columnHeights = Array.from({ length: columns }, () => 0);
  const masonryColumns = Array.from({ length: columns }, () => [] as MasonryItem[]);
  const items: MasonryItem[] = [];
  for (let position = 0; position < Math.max(0, count); position += 1) {
    let column = 0;
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if ((columnHeights[candidate] ?? 0) < (columnHeights[column] ?? 0)) column = candidate;
    }
    const item: MasonryItem = {
      position,
      x: column * (columnWidth + gap),
      y: columnHeights[column] ?? 0,
      width: columnWidth,
      height: itemHeight(position, columnWidth),
    };
    items.push(item);
    masonryColumns[column]?.push(item);
    columnHeights[column] = item.y + item.height + gap;
  }
  return {
    items,
    columns: masonryColumns,
    columnHeights,
    height: Math.max(0, ...columnHeights) - gap,
  };
}

function firstVisibleItem(items: readonly MasonryItem[], minimumY: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = items[middle];
    if (item && item.y + item.height < minimumY) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function visibleMasonryPositions(
  layout: MasonryLayout,
  scrollTop: number,
  viewportHeight: number,
): number[] {
  const minimumY = Math.max(0, scrollTop - viewportHeight * 0.7);
  const maximumY = scrollTop + viewportHeight * 1.7;
  const positions: number[] = [];
  for (const column of layout.columns) {
    for (let index = firstVisibleItem(column, minimumY); index < column.length; index += 1) {
      const item = column[index];
      if (!item || item.y > maximumY) break;
      positions.push(item.position);
    }
  }
  return positions.sort((left, right) => left - right);
}

function verticalOverlap(left: MasonryItem, right: MasonryItem): number {
  return Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

export function masonryNeighbor(
  layout: MasonryLayout,
  position: number,
  direction: VisualDirection,
): number {
  const current = layout.items[position];
  if (!current) return position;
  const columnIndex = layout.columns.findIndex((column) => column.some((item) => item.position === position));
  if (columnIndex < 0) return position;
  const column = layout.columns[columnIndex] ?? [];
  const rowIndex = column.findIndex((item) => item.position === position);
  if (direction === "up") return column[rowIndex - 1]?.position ?? position;
  if (direction === "down") return column[rowIndex + 1]?.position ?? position;

  const adjacentIndex = columnIndex + (direction === "left" ? -1 : 1);
  const adjacent = layout.columns[adjacentIndex];
  if (!adjacent?.length) return position;
  const center = current.y + current.height / 2;
  return adjacent
    .map((candidate) => ({
      candidate,
      overlap: verticalOverlap(current, candidate),
      distance: Math.abs(candidate.y + candidate.height / 2 - center),
    }))
    .sort((left, right) =>
      right.overlap - left.overlap
      || left.distance - right.distance
      || left.candidate.position - right.candidate.position,
    )[0]?.candidate.position ?? position;
}
