(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./cube.js") : root.CubeLab.CubeData,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).Graph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CubeData) {
  "use strict";

  const { FACE_COLORS, FACE_NAMES, faceRowCol, slotKey } = CubeData;
  const SQRT3 = Math.sqrt(3);
  const CENTERS = [
    { x: 0, y: 0, axis: 0 },
    { x: -0.5, y: -SQRT3 / 2, axis: 1 },
    { x: 0.5, y: -SQRT3 / 2, axis: 2 },
  ];
  const RADII = [0.81, 1.035, 1.255];
  const FACE_FOR_CLUSTER = Object.freeze({
    "0,1,0": "R",
    "0,1,1": "L",
    "0,2,0": "B",
    "0,2,1": "F",
    "1,2,0": "U",
    "1,2,1": "D",
  });
  const NORMAL_SIGN = Object.freeze({
    "0,1,0": [2, 1],
    "0,1,1": [2, -1],
    "0,2,0": [1, -1],
    "0,2,1": [1, 1],
    "1,2,0": [0, 1],
    "1,2,1": [0, -1],
  });
  const FACE_META = Object.freeze({
    U: { chinese: "上", axis: "y", normal: [0, 1, 0] },
    D: { chinese: "下", axis: "y", normal: [0, -1, 0] },
    L: { chinese: "左", axis: "x", normal: [-1, 0, 0] },
    R: { chinese: "右", axis: "x", normal: [1, 0, 0] },
    F: { chinese: "前", axis: "z", normal: [0, 0, 1] },
    B: { chinese: "后", axis: "z", normal: [0, 0, -1] },
  });
  const GRAPH_CUBE_AXES = ["y", "z", "x"];
  const CUBE_TO_GRAPH = { x: 2, y: 0, z: 1 };
  const FACE_LABEL_DIRECTIONS = Object.freeze({
    U: [0, -1],
    D: [0, 1],
    L: [-1, -0.75],
    R: [1, 0.7],
    F: [-1, 0.7],
    B: [1, -0.55],
  });
  const DISPLAY_D_COLOR = "#e9dfce";

  function circleIntersections(a, b, radiusA, radiusB) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const along = (radiusA * radiusA - radiusB * radiusB + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, radiusA * radiusA - along * along));
    const mx = a.x + (along * dx) / distance;
    const my = a.y + (along * dy) / distance;
    const ox = (-dy / distance) * height;
    const oy = (dx / distance) * height;
    return [
      { x: mx + ox, y: my + oy },
      { x: mx - ox, y: my - oy },
    ];
  }

  function circleId(axis, ring) {
    return axis * 3 + ring;
  }

  function cubePointFromGraphNode(groupCoordinates, normalGroup, normalSign) {
    const graph = groupCoordinates.slice();
    graph[normalGroup] = normalSign;
    return {
      x: graph[2],
      y: graph[0],
      z: graph[1],
    };
  }

  function buildEmbedding() {
    const nodes = [];
    let index = 0;
    for (let a = 0; a < 3; a += 1) {
      for (let b = a + 1; b < 3; b += 1) {
        for (let side = 0; side < 2; side += 1) {
          const face = FACE_FOR_CLUSTER[`${a},${b},${side}`];
          const [normalGroup, normalSign] = NORMAL_SIGN[`${a},${b},${side}`];
          for (let ringA = 0; ringA < 3; ringA += 1) {
            for (let ringB = 0; ringB < 3; ringB += 1) {
              const p = circleIntersections(
                CENTERS[a],
                CENTERS[b],
                RADII[ringA],
                RADII[ringB],
              )[side];
              const groupCoordinates = [0, 0, 0];
              groupCoordinates[a] = 1 - ringA;
              groupCoordinates[b] = 1 - ringB;
              const cube = cubePointFromGraphNode(groupCoordinates, normalGroup, normalSign);
              const { row, col } = faceRowCol(face, [cube.x, cube.y, cube.z]);
              nodes.push({
                index,
                x: p.x,
                y: p.y,
                face,
                side,
                pair: [a, b],
                rings: [ringA, ringB],
                circles: [circleId(a, ringA), circleId(b, ringB)],
                groupCoordinates,
                cube,
                row,
                col,
                slotKey: slotKey(face, row, col),
                isCenter: row === 1 && col === 1,
              });
              index += 1;
            }
          }
        }
      }
    }

    const circles = Array.from({ length: 9 }, (_, id) => ({
      id,
      axis: Math.floor(id / 3),
      ring: id % 3,
      center: CENTERS[Math.floor(id / 3)],
      radius: RADII[id % 3],
      nodes: [],
      ordered: [],
    }));
    for (const node of nodes) {
      for (const id of node.circles) circles[id].nodes.push(node.index);
    }
    const edges = [];
    const adjacency = Array.from({ length: nodes.length }, () => []);
    for (const circle of circles) {
      const center = circle.center;
      circle.ordered = circle.nodes.slice().sort((left, right) => {
        const a = nodes[left];
        const b = nodes[right];
        return Math.atan2(a.y - center.y, a.x - center.x) -
          Math.atan2(b.y - center.y, b.x - center.x);
      });
      for (let i = 0; i < circle.ordered.length; i += 1) {
        const a = circle.ordered[i];
        const b = circle.ordered[(i + 1) % circle.ordered.length];
        let startAngle = Math.atan2(nodes[a].y - center.y, nodes[a].x - center.x);
        let endAngle = Math.atan2(nodes[b].y - center.y, nodes[b].x - center.x);
        while (endAngle <= startAngle) endAngle += Math.PI * 2;
        const delta = endAngle - startAngle;
        const edge = {
          id: edges.length,
          a,
          b,
          circle: circle.id,
          startAngle,
          endAngle,
          delta,
          length: circle.radius * delta,
        };
        edges.push(edge);
        adjacency[a].push({ node: b, edge });
        adjacency[b].push({ node: a, edge });
      }
    }

    const edgeSet = new Set();
    const faceEdgeCounts = Object.create(null);
    const crossCounts = Object.create(null);
    for (const edge of edges) {
      const a = Math.min(edge.a, edge.b);
      const b = Math.max(edge.a, edge.b);
      edgeSet.add(`${a},${b}`);
      const fa = nodes[a].face;
      const fb = nodes[b].face;
      if (fa === fb) {
        faceEdgeCounts[fa] = (faceEdgeCounts[fa] || 0) + 1;
      } else {
        const term = [fa, fb].sort().join("-");
        crossCounts[term] = (crossCounts[term] || 0) + 1;
      }
    }

    return {
      centers: CENTERS,
      radii: RADII,
      nodes,
      circles,
      edges,
      adjacency,
      edgeSet,
      faceEdgeCounts,
      crossCounts,
      nodeBySlot: Object.fromEntries(nodes.map((node) => [node.slotKey, node])),
    };
  }

  const EMBEDDING = buildEmbedding();

  function validateEmbedding() {
    const errors = [];
    const uniquePositions = new Set(
      EMBEDDING.nodes.map((node) => `${node.x.toFixed(11)},${node.y.toFixed(11)}`),
    );
    if (EMBEDDING.nodes.length !== 54) errors.push(`节点数为 ${EMBEDDING.nodes.length}`);
    if (uniquePositions.size !== 54) errors.push(`交点重复，共 ${uniquePositions.size} 个`);
    if (EMBEDDING.edges.length !== 108) errors.push(`边数为 ${EMBEDDING.edges.length}`);
    if (EMBEDDING.circles.some((circle) => circle.nodes.length !== 12)) {
      errors.push("存在节点数不为 12 的圆环");
    }
    if (EMBEDDING.adjacency.some((neighbors) => neighbors.length !== 4)) {
      errors.push("存在度数不为 4 的节点");
    }
    for (const face of Object.keys(FACE_META)) {
      if (EMBEDDING.faceEdgeCounts[face] !== 12) errors.push(`${face} 面内边数错误`);
    }
    const opposite = new Set(["U-D", "D-U", "L-R", "R-L", "F-B", "B-F"]);
    if (EMBEDDING.crossCounts && Object.entries(EMBEDDING.crossCounts).some(
      ([pair, count]) => opposite.has(pair) && count > 0,
    )) {
      errors.push("相对面之间存在边");
    }
    const totalCross = Object.values(EMBEDDING.crossCounts).reduce((sum, n) => sum + n, 0);
    if (totalCross !== 36) errors.push(`跨面边数为 ${totalCross}`);
    const slotKeys = new Set(EMBEDDING.nodes.map((node) => node.slotKey));
    if (slotKeys.size !== 54) errors.push(`贴纸槽位重复，共 ${slotKeys.size} 个`);
    if (Object.values(EMBEDDING.crossCounts).some((count) => count !== 3)) {
      errors.push("存在跨面边数不为 3 的面对");
    }
    return errors;
  }

  function adjacencyBetween(idA, idB) {
    return EMBEDDING.edgeSet.has(`${Math.min(idA, idB)},${Math.max(idA, idB)}`);
  }

  function circularPath(start, end, circle) {
    const ordered = circle.ordered;
    const startIndex = ordered.indexOf(start);
    const endIndex = ordered.indexOf(end);
    if (startIndex < 0 || endIndex < 0) return null;
    const clockwise = [];
    const counter = [];
    for (let i = startIndex; ; i = (i + 1) % ordered.length) {
      clockwise.push(ordered[i]);
      if (ordered[i] === end) break;
    }
    for (let i = startIndex; ; i = (i - 1 + ordered.length) % ordered.length) {
      counter.push(ordered[i]);
      if (ordered[i] === end) break;
    }
    return clockwise.length <= counter.length ? clockwise : counter;
  }

  function shortestPath(start, end) {
    if (start === end) return { nodes: [start], edges: [], totalLength: 0 };
    let nodePath = null;
    const startNode = EMBEDDING.nodes[start];
    const endNode = EMBEDDING.nodes[end];
    if (startNode.face === endNode.face && !startNode.isCenter && !endNode.isCenter) {
      const queue = [start];
      const previous = new Map([[start, null]]);
      while (queue.length) {
        const current = queue.shift();
        if (current === end) break;
        for (const neighbor of EMBEDDING.adjacency[current]) {
          const neighborNode = EMBEDDING.nodes[neighbor.node];
          if (neighborNode.face !== startNode.face || neighborNode.isCenter) continue;
          if (previous.has(neighbor.node)) continue;
          previous.set(neighbor.node, { node: current, edge: neighbor.edge });
          queue.push(neighbor.node);
        }
      }
      if (previous.has(end)) {
        nodePath = [];
        let cursor = end;
        while (cursor !== null) {
          nodePath.push(cursor);
          const item = previous.get(cursor);
          cursor = item ? item.node : null;
        }
        nodePath.reverse();
      }
    }
    let bestCircleLength = Infinity;
    if (!nodePath) {
      for (const circle of EMBEDDING.circles) {
        if (!circle.nodes.includes(start) || !circle.nodes.includes(end)) continue;
        const candidate = circularPath(start, end, circle);
        if (candidate && candidate.length < bestCircleLength) {
          bestCircleLength = candidate.length;
          nodePath = candidate;
        }
      }
    }
    if (!nodePath) {
      const queue = [start];
      const previous = new Map([[start, null]]);
      while (queue.length) {
        const current = queue.shift();
        if (current === end) break;
        for (const neighbor of EMBEDDING.adjacency[current]) {
          if (previous.has(neighbor.node)) continue;
          previous.set(neighbor.node, { node: current, edge: neighbor.edge });
          queue.push(neighbor.node);
        }
      }
      if (!previous.has(end)) return null;
      nodePath = [];
      let cursor = end;
      while (cursor !== null) {
        nodePath.push(cursor);
        const item = previous.get(cursor);
        cursor = item ? item.node : null;
      }
      nodePath.reverse();
    }
    const pathEdges = [];
    let totalLength = 0;
    for (let i = 0; i < nodePath.length - 1; i += 1) {
      const a = nodePath[i];
      const b = nodePath[i + 1];
      const link = EMBEDDING.adjacency[a].find((neighbor) => neighbor.node === b);
      if (!link) return null;
      pathEdges.push(link.edge);
      totalLength += link.edge.length;
    }
    return { nodes: nodePath, edges: pathEdges, totalLength };
  }

  function interpolateOnEdge(edge, from, to, fraction) {
    const circle = EMBEDDING.circles[edge.circle];
    const center = circle.center;
    let startAngle;
    let endAngle;
    if (edge.a === from && edge.b === to) {
      startAngle = edge.startAngle;
      endAngle = edge.endAngle;
    } else if (edge.b === from && edge.a === to) {
      startAngle = edge.endAngle;
      endAngle = edge.startAngle;
    } else {
      throw new Error("圆弧方向与路径不一致");
    }
    let delta = endAngle - startAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const angle = startAngle + delta * fraction;
    const radius = circle.radius;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
      circle: circle.id,
    };
  }

  function samplePath(path, progress) {
    if (!path || path.totalLength === 0) {
      const node = EMBEDDING.nodes[path ? path.nodes[0] : 0];
      return { x: node.x, y: node.y, angle: 0, circle: null };
    }
    const target = Math.max(0, Math.min(1, progress)) * path.totalLength;
    let accumulated = 0;
    for (let i = 0; i < path.edges.length; i += 1) {
      const edge = path.edges[i];
      if (target <= accumulated + edge.length || i === path.edges.length - 1) {
        const local = Math.max(0, Math.min(1, (target - accumulated) / edge.length));
        return interpolateOnEdge(edge, path.nodes[i], path.nodes[i + 1], local);
      }
      accumulated += edge.length;
    }
    const node = EMBEDDING.nodes[path.nodes[path.nodes.length - 1]];
    return { x: node.x, y: node.y, angle: 0, circle: null };
  }

  function slotColors(cube) {
    const result = new Array(54).fill("#000000");
    const table = cube.stickerTable();
    for (const node of EMBEDDING.nodes) {
      const entry = table[node.slotKey];
      if (entry) result[node.index] = entry.color;
    }
    return result;
  }

  function stickerNodes(cube) {
    const result = new Array(54).fill(null);
    const table = cube.stickerTable();
    for (const node of EMBEDDING.nodes) {
      const entry = table[node.slotKey];
      if (entry) result[node.index] = entry.sticker;
    }
    return result;
  }

  function movementPaths(startCube, endCube) {
    const startStickers = stickerNodes(startCube);
    const endStickers = stickerNodes(endCube);
    const endIndexBySticker = new Map(endStickers.map((sticker, index) => [sticker.id, index]));
    const paths = [];
    for (let start = 0; start < 54; start += 1) {
      const sticker = startStickers[start];
      const end = endIndexBySticker.get(sticker.id);
      if (end === undefined) continue;
      paths.push({
        sticker,
        start,
        end,
        path: shortestPath(start, end),
      });
    }
    return paths;
  }

  function convexHull(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length <= 2) return sorted;
    const cross = (o, a, b) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function expandHull(hull, center, padding) {
    return hull.map((point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      return {
        x: point.x + (dx / length) * padding,
        y: point.y + (dy / length) * padding,
      };
    });
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  class GraphView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });
      this.dpr = 1;
      this.cssWidth = 1;
      this.cssHeight = 1;
      this.view = null;
      this.labels = [];
      this.lastSignature = "";
      this.highlightCircles = new Set();
      this.animation = null;
      this.needsResize = true;
      this.fontFamily = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", "Microsoft YaHei", monospace';
    }

    resize(dpr = window.devicePixelRatio || 1) {
      const rect = this.canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      const effectiveDpr = Math.max(1, dpr);
      const pixelWidth = Math.round(cssWidth * effectiveDpr);
      const pixelHeight = Math.round(cssHeight * effectiveDpr);
      if (
        this.canvas.width !== pixelWidth ||
        this.canvas.height !== pixelHeight ||
        Math.abs(cssWidth - this.cssWidth) > 0.1 ||
        Math.abs(cssHeight - this.cssHeight) > 0.1
      ) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
        this.dpr = effectiveDpr;
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        this.computeView();
        this.computeLabels();
        return true;
      }
      this.dpr = effectiveDpr;
      return false;
    }

    computeView() {
      const ringBounds = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      for (const center of EMBEDDING.centers) {
        ringBounds.minX = Math.min(ringBounds.minX, center.x - RADII[2]);
        ringBounds.maxX = Math.max(ringBounds.maxX, center.x + RADII[2]);
        ringBounds.minY = Math.min(ringBounds.minY, center.y - RADII[2]);
        ringBounds.maxY = Math.max(ringBounds.maxY, center.y + RADII[2]);
      }
      const marginX = this.cssWidth < 360 ? 2 : 3;
      const marginY = 2;
      const availableWidth = Math.max(1, this.cssWidth - marginX * 2);
      const availableHeight = Math.max(1, this.cssHeight - marginY * 2);
      const scale = Math.min(
        availableWidth / (ringBounds.maxX - ringBounds.minX),
        availableHeight / (ringBounds.maxY - ringBounds.minY),
      );
      const width = (ringBounds.maxX - ringBounds.minX) * scale;
      const height = (ringBounds.maxY - ringBounds.minY) * scale;
      const originX = (this.cssWidth - width) / 2 - ringBounds.minX * scale;
      const originY = (this.cssHeight - height) / 2 + ringBounds.maxY * scale;
      this.view = {
        scale,
        originX,
        originY,
        graphBounds: {
          minX: ringBounds.minX * scale + originX,
          maxX: ringBounds.maxX * scale + originX,
          minY: originY - ringBounds.maxY * scale,
          maxY: originY - ringBounds.minY * scale,
        },
      };
    }

    toScreen(point) {
      return {
        x: this.view.originX + point.x * this.view.scale,
        y: this.view.originY - point.y * this.view.scale,
      };
    }

    clusterCenter(face) {
      const nodes = EMBEDDING.nodes.filter((node) => node.face === face);
      return {
        x: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
        y: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
      };
    }

    computeLabels() {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = `10px ${this.fontFamily}`;
      const labels = [];
      const allNodePoints = EMBEDDING.nodes.map((node) => this.toScreen(node));
      const preferredOrder = ["U", "D", "L", "R", "F", "B"];
      for (const face of preferredOrder) {
        const center = this.clusterCenter(face);
        const centerScreen = this.toScreen(center);
        const direction = FACE_LABEL_DIRECTIONS[face];
        const baseAngle = Math.atan2(direction[1], direction[0]);
        const text = `${face} ${FACE_NAMES[face]}`;
        const textWidth = ctx.measureText(text).width;
        const width = Math.max(44, Math.ceil(textWidth) + 16);
        const height = 18;
        let placement = null;
        const angleOrder = [baseAngle];
        for (let i = 1; i <= 11; i += 1) {
          angleOrder.push(baseAngle + (i * Math.PI) / 6);
          angleOrder.push(baseAngle - (i * Math.PI) / 6);
        }
        const radii = [16, 24, 32, 40, 50, 60, 72, 86, 102, 120];
        search:
        for (const radius of radii) {
          for (const angle of angleOrder) {
            const cx = centerScreen.x + Math.cos(angle) * radius;
            const cy = centerScreen.y + Math.sin(angle) * radius;
            const rect = {
              x: cx - width / 2,
              y: cy - height / 2,
              width,
              height,
              cx,
              cy,
            };
            if (
              rect.x < 4 ||
              rect.y < 4 ||
              rect.x + rect.width > this.cssWidth - 4 ||
              rect.y + rect.height > this.cssHeight - 4
            ) continue;
            for (const point of allNodePoints) {
              const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
              const nearestY = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
              if (Math.hypot(point.x - nearestX, point.y - nearestY) < 4 + 4.2) continue search;
            }
            for (const other of labels) {
              const gap = 4;
              if (!(
                rect.x + rect.width + gap < other.x ||
                other.x + other.width + gap < rect.x ||
                rect.y + rect.height + gap < other.y ||
                other.y + other.height + gap < rect.y
              )) continue search;
            }
            placement = rect;
            break search;
          }
        }
        if (!placement) {
          placement = {
            x: Math.min(this.cssWidth - width - 4, Math.max(4, centerScreen.x - width / 2)),
            y: Math.min(this.cssHeight - height - 4, Math.max(4, centerScreen.y - 24)),
            width,
            height,
            cx: centerScreen.x,
            cy: centerScreen.y,
          };
        }
        labels.push({ face, text, ...placement });
      }
      this.labels = labels;
      ctx.restore();
    }

    setHighlight(move) {
      this.highlightCircles.clear();
      if (!move) return;
      const graphAxis = CUBE_TO_GRAPH[move.axis];
      const ringValues = new Set(move.layers.map((layer) => 1 - layer));
      for (const ring of ringValues) {
        if (ring >= 0 && ring <= 2) this.highlightCircles.add(circleId(graphAxis, ring));
      }
    }

    setAnimation(animation) {
      this.animation = animation;
    }

    draw(cube, options = {}) {
      const ctx = this.ctx;
      if (!ctx) return;
      const rect = this.canvas.getBoundingClientRect();
      if (
        this.canvas.width !== Math.round(rect.width * this.dpr) ||
        this.canvas.height !== Math.round(rect.height * this.dpr)
      ) {
        this.resize(this.dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const signature = `${this.cssWidth.toFixed(1)}x${this.cssHeight.toFixed(1)}@${this.dpr}`;
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        this.computeLabels();
      }
      const colors = slotColors(cube).map((color) =>
        color === FACE_COLORS.D ? DISPLAY_D_COLOR : color);
      this.centerColors = Object.fromEntries(
        EMBEDDING.nodes
          .filter((node) => node.isCenter)
          .map((node) => [node.face, colors[node.index]]),
      );
      this.drawClusterWashes(ctx, this.centerColors);
      this.drawRings(ctx);
      this.drawBalls(ctx, cube, options.animation || null);
      this.drawLabels(ctx);
    }

    drawClusterWashes(ctx, centerColors) {
      const palette = {
        U: FACE_COLORS.U,
        R: FACE_COLORS.R,
        F: FACE_COLORS.F,
        D: FACE_COLORS.D,
        L: FACE_COLORS.L,
        B: FACE_COLORS.B,
      };
      for (const face of Object.keys(palette)) {
        const fillColor = centerColors[face] || palette[face];
        const nodes = EMBEDDING.nodes.filter((node) => node.face === face);
        if (!nodes.length) continue;
        const hull = convexHull(nodes.map((node) => this.toScreen(node)));
        const centerRaw = this.clusterCenter(face);
        const center = this.toScreen(centerRaw);
        const expanded = expandHull(hull, center, Math.max(5, this.view.scale * 0.055));
        ctx.beginPath();
        expanded.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else {
            const previous = expanded[index - 1];
            const midX = (previous.x + point.x) / 2;
            const midY = (previous.y + point.y) / 2;
            ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
          }
        });
        const first = expanded[0];
        const last = expanded[expanded.length - 1];
        ctx.quadraticCurveTo(last.x, last.y, (last.x + first.x) / 2, (last.y + first.y) / 2);
        ctx.quadraticCurveTo(first.x, first.y, first.x, first.y);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(fillColor, face === "D" ? 0.15 : 0.12);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(fillColor, 0.48);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    drawRings(ctx) {
      const ink = ["#918677", "#756c60", "#5d564d"];
      for (const circle of EMBEDDING.circles) {
        const center = this.toScreen(circle.center);
        const radius = circle.radius * this.view.scale;
        const highlighted = this.highlightCircles.has(circle.id);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        if (highlighted) {
          ctx.strokeStyle = "rgba(200,86,67,0.16)";
          ctx.lineWidth = 3.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = "#c85643";
          ctx.lineWidth = 1.65;
          ctx.stroke();
        } else {
          ctx.strokeStyle = ink[circle.ring];
          ctx.lineWidth = 1 + circle.ring * 0.24;
          ctx.stroke();
        }
      }
    }

    drawBalls(ctx, cube, animation) {
      const baseColors = slotColors(cube).map((color) =>
        color === FACE_COLORS.D ? DISPLAY_D_COLOR : color);
      let positions = null;
      if (animation && animation.startCube && animation.endCube) {
        const progress = Math.max(0, Math.min(1, animation.progress || 0));
        const moving = animation.paths || movementPaths(animation.startCube, animation.endCube);
        positions = new Array(54).fill(null);
        for (let i = 0; i < 54; i += 1) {
          const node = EMBEDDING.nodes[i];
          positions[i] = {
            x: node.x,
            y: node.y,
            color: baseColors[i],
            moving: false,
          };
        }
        for (const item of moving) {
          const point = samplePath(item.path, progress);
          positions[item.start] = {
            x: point.x,
            y: point.y,
            color: item.sticker.color,
            moving: true,
          };
        }
      }

      for (let i = 0; i < 54; i += 1) {
        let point;
        let color;
        if (positions) {
          const item = positions[i];
          if (!item) continue;
          point = this.toScreen(item);
          color = item.color;
        } else {
          point = this.toScreen(EMBEDDING.nodes[i]);
          color = baseColors[i];
        }
        const node = EMBEDDING.nodes[i];
        const radius = this.cssWidth < 340 ? 3.65 : 4.05;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = node.face === "D" || node.face === "U" ? 1.8 : 1.55;
        ctx.strokeStyle = "#252229";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x - radius * 0.31, point.y - radius * 0.36, Math.max(0.85, radius * 0.24), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.48)";
        ctx.fill();
        if (node.isCenter && !positions) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius * 0.48, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(37,34,41,0.5)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    drawLabels(ctx) {
      for (const label of this.labels) {
        roundRect(ctx, label.x, label.y, label.width, label.height, 8);
        ctx.fillStyle = "rgba(251,247,238,0.94)";
        ctx.fill();
        ctx.strokeStyle = "rgba(37,34,41,0.72)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(label.x + 7.5, label.y + label.height / 2, 3, 0, Math.PI * 2);
        const fallback = label.face === "D" ? DISPLAY_D_COLOR : FACE_COLORS[label.face];
        ctx.fillStyle = this.centerColors?.[label.face] || fallback;
        ctx.fill();
        ctx.strokeStyle = "#252229";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = "#252229";
        ctx.font = `10px ${this.fontFamily}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(label.text, label.x + 14, label.y + label.height / 2 + 0.2);
      }
    }
  }

  return {
    EMBEDDING,
    GRAPH_CUBE_AXES,
    FACE_META,
    buildEmbedding,
    validateEmbedding,
    adjacencyBetween,
    shortestPath,
    samplePath,
    slotColors,
    stickerNodes,
    movementPaths,
    GraphView,
    circleIntersections,
    CUBE_TO_GRAPH,
  };
});
