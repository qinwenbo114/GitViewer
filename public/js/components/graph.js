const PALETTE = [
  '#5a9fd4', '#c98a5b', '#6fb37a', '#b07fd6', '#d4b264',
  '#d07d7d', '#54b3b3', '#8f8fd8', '#a8b25f', '#7ab5d6',
  '#c98fb5', '#82bf8f',
];

export const LANE_WIDTH = 13;
export const GRAPH_PAD = 14;
export const MIN_GRAPH_WIDTH = 96;

export function graphWidth(commits) {
  let maxLane = 0;
  for (const commit of commits) {
    const g = commit.graph;
    if (!g) continue;
    maxLane = Math.max(maxLane, g.lane, g.width - 1);
    for (const edge of g.parents || []) maxLane = Math.max(maxLane, edge.lane);
    for (const edge of g.through || []) maxLane = Math.max(maxLane, edge.lane);
    for (const edge of g.mergeFrom || []) maxLane = Math.max(maxLane, edge.lane);
  }
  return Math.max(MIN_GRAPH_WIDTH, GRAPH_PAD * 2 + (maxLane + 1) * LANE_WIDTH);
}

export function laneX(lane) {
  return GRAPH_PAD + lane * LANE_WIDTH;
}

export function drawGraph(canvas, commits, {
  rowHeight = 28,
  selectedIndex = -1,
  theme = 'dark',
  width = MIN_GRAPH_WIDTH,
  flat = false,
} = {}) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const height = Math.max(commits.length * rowHeight, 1);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const color = (index) => PALETTE[index % PALETTE.length];
  const bg = theme === 'light' ? '#ffffff' : '#1e1f22';

  if (flat) {
    const cx = GRAPH_PAD;
    ctx.strokeStyle = theme === 'light' ? '#d7dbe0' : '#33363b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
    commits.forEach((commit, index) => {
      const cy = index * rowHeight + rowHeight / 2;
      const graph = commit.graph || {};
      if (index === selectedIndex) {
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = theme === 'light' ? 'rgba(31,111,235,.16)' : 'rgba(90,159,212,.22)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = color(graph.color || 0);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = bg;
      ctx.stroke();
    });
    return;
  }

  commits.forEach((commit, index) => {
    const graph = commit.graph;
    if (!graph) return;
    const top = index * rowHeight;
    const center = top + rowHeight / 2;
    const bottom = top + rowHeight;

    for (const line of graph.through || []) {
      ctx.strokeStyle = color(line.color);
      ctx.beginPath();
      ctx.moveTo(laneX(line.lane), top);
      ctx.lineTo(laneX(line.lane), bottom);
      ctx.stroke();
    }

    for (const line of graph.mergeFrom || []) {
      const x1 = laneX(line.lane);
      const x2 = laneX(graph.lane);
      ctx.strokeStyle = color(line.color);
      ctx.beginPath();
      ctx.moveTo(x1, top);
      const midY = (top + center) / 2;
      ctx.bezierCurveTo(x1, midY, x2, midY, x2, center);
      ctx.stroke();
    }

    for (const edge of graph.parents || []) {
      const x1 = laneX(graph.lane);
      const x2 = laneX(edge.lane);
      ctx.strokeStyle = color(edge.color);
      ctx.beginPath();
      if (x1 === x2) {
        ctx.moveTo(x1, center);
        ctx.lineTo(x2, bottom);
      } else {
        ctx.moveTo(x1, center);
        const midY = (center + bottom) / 2;
        ctx.bezierCurveTo(x1, midY, x2, midY, x2, bottom);
      }
      ctx.stroke();
    }

    const cx = laneX(graph.lane);
    const isSelected = index === selectedIndex;
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cx, center, 6.4, 0, Math.PI * 2);
      ctx.fillStyle = theme === 'light' ? 'rgba(31,111,235,.18)' : 'rgba(90,159,212,.25)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, center, 4.1, 0, Math.PI * 2);
    ctx.fillStyle = color(graph.color);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = bg;
    ctx.stroke();
  });
}
