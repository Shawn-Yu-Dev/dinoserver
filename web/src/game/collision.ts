/** 轴对齐矩形（左上角坐标 + 宽高）。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** AABB 相交检测：两矩形有重叠即返回 true。 */
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
