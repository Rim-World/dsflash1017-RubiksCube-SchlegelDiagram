"use strict";

const assert = require("node:assert/strict");
const CubeData = require("../src/cube.js");
const Graph = require("../src/graph.js");

function physicalAdjacent(a, b) {
  const pa = a.cube;
  const pb = b.cube;
  if (pa.x === pb.x && pa.y === pb.y && pa.z === pb.z) return true;
  if (a.face !== b.face) return false;
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) + Math.abs(pa.z - pb.z) === 1;
}

function samples() {
  return [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];
}

function positionsAt(moving, progress) {
  const positions = new Array(54);
  const movingStarts = new Set(moving.map((item) => item.start));
  for (let index = 0; index < 54; index += 1) {
    if (movingStarts.has(index)) continue;
    const node = Graph.EMBEDDING.nodes[index];
    positions[index] = { x: node.x, y: node.y, circle: null };
  }
  for (const item of moving) {
    positions[item.start] = Graph.samplePath(item.path, progress);
  }
  return positions;
}

function assertMoveAnimation(move, label) {
  const start = CubeData.Cube.solved();
  const end = start.clone();
  end.rotateLayer(move.axis, move.layers, move.sign);
  const moving = Graph.movementPaths(start, end);
  assert.equal(moving.length, 54, `${label} 没有覆盖全部贴纸`);
  for (const progress of samples()) {
    const positions = positionsAt(moving, progress);
    for (let i = 0; i < 54; i += 1) {
      const point = positions[i];
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${label} 出现无效球点`);
      if (point.circle !== null && point.circle !== undefined) {
        const circle = Graph.EMBEDDING.circles[point.circle];
        const distance = Math.hypot(point.x - circle.center.x, point.y - circle.center.y);
        assert.ok(Math.abs(distance - circle.radius) < 1e-8, `${label} 球点离开所属圆弧`);
      }
    }
    for (let i = 0; i < 54; i += 1) {
      for (let j = i + 1; j < 54; j += 1) {
        const distance = Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y,
        );
        assert.ok(distance > 1e-7, `${label} 在 ${progress} 时出现球点重合`);
      }
    }
  }
  for (const item of moving) {
    const first = Graph.samplePath(item.path, 0);
    const last = Graph.samplePath(item.path, 1);
    const startNode = Graph.EMBEDDING.nodes[item.start];
    const endNode = Graph.EMBEDDING.nodes[item.end];
    assert.ok(Math.hypot(first.x - startNode.x, first.y - startNode.y) < 1e-8);
    assert.ok(Math.hypot(last.x - endNode.x, last.y - endNode.y) < 1e-8);
  }
  if (move.face) {
    const graphAxis = Graph.CUBE_TO_GRAPH[move.axis];
    const rings = new Set(move.layers.map((layer) => 1 - layer));
    for (const ring of rings) {
      const circleId = graphAxis * 3 + ring;
      const circle = Graph.EMBEDDING.circles[circleId];
      const lengthCounts = {};
      for (const node of circle.nodes) {
        const item = moving.find((entry) => entry.start === node);
        const length = item ? item.path.nodes.length - 1 : 0;
        lengthCounts[length] = (lengthCounts[length] || 0) + 1;
      }
      assert.equal(lengthCounts[3], 12, `${label} 的转动层圆环没有整体滑 3 位`);
    }
    const face = move.face;
    const faceNodes = Graph.EMBEDDING.nodes.filter((node) => node.face === face);
    const center = faceNodes.find((node) => node.isCenter);
    const centerItem = moving.find((item) => item.start === center.index);
    assert.equal(centerItem.path.nodes.length, 1, `${label} 的面中心不应移动`);
    let cornerPaths = 0;
    for (const node of faceNodes) {
      if (node.isCenter) continue;
      const item = moving.find((entry) => entry.start === node.index);
      if (item.path.nodes.length - 1 === 2) cornerPaths += 1;
    }
    assert.equal(cornerPaths, 8, `${label} 的面内 8 个点没有使用两段路径`);
  }
}

function main() {
  const errors = Graph.validateEmbedding();
  assert.deepEqual(errors, []);
  assert.equal(Graph.EMBEDDING.nodes.length, 54);
  assert.equal(Graph.EMBEDDING.edges.length, 108);
  assert.equal(new Set(Graph.EMBEDDING.nodes.map((node) => node.slotKey)).size, 54);
  assert.ok(Graph.EMBEDDING.circles.every((circle) => circle.nodes.length === 12));
  assert.ok(Graph.EMBEDDING.adjacency.every((neighbors) => neighbors.length === 4));
  for (const face of "URFDLB") {
    assert.equal(Graph.EMBEDDING.faceEdgeCounts[face], 12);
    assert.equal(Graph.EMBEDDING.nodes.filter((node) => node.face === face).length, 9);
  }
  for (const node of Graph.EMBEDDING.nodes) {
    const [r, c] = node.rings;
    let expected;
    if (node.face === "U") expected = [2 - r, 2 - c];
    else if (node.face === "R" || node.face === "B") expected = [r, c];
    else expected = [r, 2 - c];
    assert.deepEqual([node.row, node.col], expected, `${node.face} 面 ${r}${c} 格映射错误`);
  }
  assert.equal(
    Object.values(Graph.EMBEDDING.crossCounts).reduce((sum, count) => sum + count, 0),
    36,
  );
  for (const [pair, count] of Object.entries(Graph.EMBEDDING.crossCounts)) {
    assert.ok(!["U-D", "D-U", "R-L", "L-R", "F-B", "B-F"].includes(pair));
    assert.equal(count, 3);
  }
  for (const edge of Graph.EMBEDDING.edges) {
    assert.ok(
      physicalAdjacent(Graph.EMBEDDING.nodes[edge.a], Graph.EMBEDDING.nodes[edge.b]),
      "图中存在非物理相邻边",
    );
  }

  const outerMoves = [];
  for (const face of ["U", "R", "F", "D", "L", "B"]) {
    for (const wide of [false, true]) {
      for (const suffix of ["", "'", "2"]) {
        const token = `${face}${wide ? "w" : ""}${suffix}`;
        const parsed = CubeData.parseMove(token);
        outerMoves.push({
          move: parsed,
          sign: Math.abs(parsed.angle) === 2 ? 1 : parsed.angle,
        });
      }
    }
  }
  assert.equal(outerMoves.length, 36);
  for (const { move, sign } of outerMoves) {
    assertMoveAnimation({
      ...move,
      sign,
    }, move.name);
  }
  for (const token of ["M", "M'", "E", "E'", "S", "S'", "x", "y'", "z2"]) {
    const move = CubeData.parseMove(token);
    assertMoveAnimation({
      ...move,
      sign: move.angle === 2 ? 1 : move.angle,
    }, token);
  }

  const solved = CubeData.Cube.solved();
  const halfway = solved.clone().rotateLayer("y", [1], 1);
  const second = halfway.clone().rotateLayer("y", [1], 1);
  const firstPaths = Graph.movementPaths(solved, halfway);
  const secondPaths = Graph.movementPaths(halfway, second);
  for (const list of [firstPaths, secondPaths]) {
    for (const progress of samples()) {
      const positions = positionsAt(list, progress);
      for (let i = 0; i < 54; i += 1) {
        for (let j = i + 1; j < 54; j += 1) {
          assert.ok(
            Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y) > 1e-7,
          );
        }
      }
    }
  }

  process.stdout.write("test-graph: 54 点、108 弧、36 种外层与宽层转动路径检查通过。\n");
}

main();
