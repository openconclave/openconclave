import { BaseEdge, type EdgeProps, type ConnectionLineComponentProps, Position } from "@xyflow/react";

const ARROW_SIZE = 10;
const GRID = 20;
const R = 16;
const HANDLE_R = 6; // handle circle visual radius (12px diameter / 2)

function brighten(color: string): string {
  const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (!m) return color;
  return `oklch(0.82 ${m[2]} ${m[3]})`;
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

type Pt = [number, number];

function dirVec(p: Position): Pt {
  if (p === Position.Top) return [0, -1];
  if (p === Position.Bottom) return [0, 1];
  if (p === Position.Left) return [-1, 0];
  return [1, 0];
}

/**
 * Build rounded path from waypoints.
 * Every corner gets a circular arc of radius R (clamped to fit).
 */
function roundedPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], curr = pts[i], next = pts[i + 1];
    const dx1 = prev[0] - curr[0], dy1 = prev[1] - curr[1];
    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
    const len1 = Math.abs(dx1) + Math.abs(dy1);
    const len2 = Math.abs(dx2) + Math.abs(dy2);
    const cross = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(cross) < 0.01 || len1 < 1 || len2 < 1) {
      d += ` L ${curr[0]} ${curr[1]}`;
      continue;
    }

    const cr = Math.min(R, len1 / 2, len2 / 2);
    const asx = curr[0] + (dx1 / len1) * cr;
    const asy = curr[1] + (dy1 / len1) * cr;
    const aex = curr[0] + (dx2 / len2) * cr;
    const aey = curr[1] + (dy2 / len2) * cr;
    const sweep = cross > 0 ? 0 : 1;

    d += ` L ${asx} ${asy} A ${cr} ${cr} 0 0 ${sweep} ${aex} ${aey}`;
  }

  d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
  return d;
}

export { buildPath as buildMiniMapPath };

function buildPath(
  sx: number, sy: number, sp: Position,
  tx: number, ty: number, tp: Position,
): string {
  const [sdx, sdy] = dirVec(sp);
  const [tdx, tdy] = dirVec(tp);
  const sxr = snap(sx), syr = snap(sy);
  const txr = snap(tx), tyr = snap(ty);

  // Straight line
  if (sdx === 0 && tdx === 0 && sxr === txr) return `M ${sxr} ${syr} L ${txr} ${tyr}`;
  if (sdy === 0 && tdy === 0 && syr === tyr) return `M ${sxr} ${syr} L ${txr} ${tyr}`;

  const sVert = sdx === 0;
  const tVert = tdx === 0;

  if (sVert && tVert) {
    // Same direction FIRST (bottom→bottom, top→top): always U-shape
    if (sdy === tdy) {
      const base = sdy < 0 ? Math.min(syr, tyr) : Math.max(syr, tyr);
      const escapeY = snap(base + sdy * GRID);
      return roundedPath([[sxr, syr], [sxr, escapeY], [txr, escapeY], [txr, tyr]]);
    }

    // Opposite direction (bottom→top, top→bottom)
    const normalFlow = sdy > 0 ? syr < tyr : syr > tyr;

    if (normalFlow) {
      if (sxr === txr) return `M ${sxr} ${syr} L ${txr} ${tyr}`;
      const dx = Math.abs(sxr - txr);
      const dy = Math.abs(tyr - syr);
      // One grid point apart vertically: always straight line
      if (dy <= GRID) {
        return `M ${sxr} ${syr} L ${txr} ${tyr}`;
      }
      // Small horizontal offset: jog near source, then straight to target
      if (dx <= GRID * 2) {
        const jogY = syr + sdy * GRID;
        return roundedPath([[sxr, syr], [sxr, jogY], [txr, jogY], [txr, tyr]]);
      }
      const bridgeY = snap((syr + tyr) / 2);
      return roundedPath([[sxr, syr], [sxr, bridgeY], [txr, bridgeY], [txr, tyr]]);
    }
    // Opposite direction reverse flow: escape to the side
    const s1y = syr + sdy * GRID;
    const t1y = tyr + tdy * GRID;
    const escapeX = snap(Math.max(sxr, txr) + 80);
    return roundedPath([
      [sxr, syr], [sxr, s1y], [escapeX, s1y], [escapeX, t1y], [txr, t1y], [txr, tyr],
    ]);
  }

  if (!sVert && !tVert) {
    // Same direction FIRST (left→left, right→right): always U-shape
    if (sdx === tdx) {
      const base = sdx < 0 ? Math.min(sxr, txr) : Math.max(sxr, txr);
      const escapeX = snap(base + sdx * GRID);
      return roundedPath([[sxr, syr], [escapeX, syr], [escapeX, tyr], [txr, tyr]]);
    }

    // Opposite direction (right→left, left→right)
    const normalFlow = sdx > 0 ? sxr < txr : sxr > txr;

    if (normalFlow) {
      if (syr === tyr) return `M ${sxr} ${syr} L ${txr} ${tyr}`;
      const dx = Math.abs(txr - sxr);
      // One grid point apart horizontally: always straight line
      if (dx <= GRID) {
        return `M ${sxr} ${syr} L ${txr} ${tyr}`;
      }
      const dy = Math.abs(syr - tyr);
      if (dy <= GRID * 2) {
        const jogX = sxr + sdx * GRID;
        return roundedPath([[sxr, syr], [jogX, syr], [jogX, tyr], [txr, tyr]]);
      }
      const bridgeX = snap((sxr + txr) / 2);
      return roundedPath([[sxr, syr], [bridgeX, syr], [bridgeX, tyr], [txr, tyr]]);
    }
    // Opposite direction reverse flow: escape around
    const s1x = sxr + sdx * GRID;
    const t1x = txr + tdx * GRID;
    const escapeY = snap(Math.max(syr, tyr) + 80);
    return roundedPath([
      [sxr, syr], [s1x, syr], [s1x, escapeY], [t1x, escapeY], [t1x, tyr], [txr, tyr],
    ]);
  }

  // Perpendicular routing
  if (sVert) {
    // Source vertical, target horizontal
    // L-shape OK when: source exits toward target Y AND source is on correct approach side
    const sourceOk = (tyr - syr) * sdy > 0;
    const targetOk = (sxr - txr) * tdx > 0;
    if (sourceOk && targetOk) {
      return roundedPath([[sxr, syr], [sxr, tyr], [txr, tyr]]);
    }
    const approachX = txr + tdx * GRID;
    const escapeY = syr + sdy * GRID;
    return roundedPath([[sxr, syr], [sxr, escapeY], [approachX, escapeY], [approachX, tyr], [txr, tyr]]);
  }
  // Source horizontal, target vertical
  const sourceOk = (txr - sxr) * sdx > 0;
  const targetOk = (syr - tyr) * tdy > 0;
  if (sourceOk && targetOk) {
    return roundedPath([[sxr, syr], [txr, syr], [txr, tyr]]);
  }
  const approachY = tyr + tdy * GRID;
  const escapeX = sxr + sdx * GRID;
  return roundedPath([[sxr, syr], [escapeX, syr], [escapeX, approachY], [txr, approachY], [txr, tyr]]);
}

export function RoundedEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, selected,
}: EdgeProps) {
  const rawPath = buildPath(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition);

  const rawTipX = snap(targetX), rawTipY = snap(targetY);
  const sxr = snap(sourceX), syr = snap(sourceY);
  const [sdx, sdy] = dirVec(sourcePosition);

  // Arrow direction: follow line direction for straight diagonals, handle direction otherwise
  let adx: number, ady: number;
  const isStraight = !rawPath.includes("A") && (rawPath.match(/ L /g) || []).length <= 1;
  if (isStraight && (sxr !== rawTipX || syr !== rawTipY)) {
    const lx = rawTipX - sxr, ly = rawTipY - syr;
    const len = Math.sqrt(lx * lx + ly * ly);
    adx = -lx / len;
    ady = -ly / len;
  } else {
    [adx, ady] = dirVec(targetPosition);
  }

  // Trim path to handle circle edges (so glow doesn't bleed into circles)
  // Source: for straight diagonals, offset along line direction
  let startX: number, startY: number;
  if (isStraight && (sxr !== rawTipX || syr !== rawTipY)) {
    // adx/ady points away from target, so negate for source→target direction
    startX = sxr - adx * HANDLE_R;
    startY = syr - ady * HANDLE_R;
  } else {
    startX = sxr + sdx * HANDLE_R;
    startY = syr + sdy * HANDLE_R;
  }
  const endX = rawTipX + adx * HANDLE_R;
  const endY = rawTipY + ady * HANDLE_R;
  const path = rawPath
    .replace(/^M ([\d.-]+) ([\d.-]+)/, `M ${startX} ${startY}`)
    .replace(/([\d.-]+) ([\d.-]+)$/, `${endX} ${endY}`);

  // Arrowhead tip at handle circle edge
  const tipX = endX;
  const tipY = endY;
  const baseX = tipX + adx * ARROW_SIZE;
  const baseY = tipY + ady * ARROW_SIZE;
  const half = ARROW_SIZE * 0.5;

  const arrowPoints = [
    `${tipX},${tipY}`,
    `${baseX + (-ady) * half},${baseY + adx * half}`,
    `${baseX - (-ady) * half},${baseY - adx * half}`,
  ].join(" ");

  const baseColor = (style?.stroke as string) ?? "oklch(0.65 0.18 200)";
  const edgeColor = selected ? brighten(baseColor) : baseColor;

  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, stroke: edgeColor }} />
      <polygon points={arrowPoints} fill={edgeColor} stroke="none" pointerEvents="none" />
    </>
  );
}

export function CustomConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition }: ConnectionLineComponentProps) {
  const tp = toPosition ?? Position.Top;
  const path = buildPath(fromX, fromY, fromPosition, toX, toY, tp);
  return <path d={path} fill="none" stroke="oklch(0.78 0.18 135)" strokeWidth={1.5} className="animated" />;
}
