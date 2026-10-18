(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).Geometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRoundedBox(halfExtent = 0.46, rounding = 0.07, segments = 10) {
    const positions = [];
    const normals = [];
    const indices = [];
    const inner = halfExtent - rounding;
    const faces = [
      { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
      { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
      { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
      { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
      { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
      { normal: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
    ];
    for (const face of faces) {
      const base = positions.length / 3;
      for (let row = 0; row <= segments; row += 1) {
        const vv = row / segments * 2 - 1;
        for (let col = 0; col <= segments; col += 1) {
          const uu = col / segments * 2 - 1;
          const point = [
            face.normal[0] * halfExtent + face.u[0] * uu * halfExtent + face.v[0] * vv * halfExtent,
            face.normal[1] * halfExtent + face.u[1] * uu * halfExtent + face.v[1] * vv * halfExtent,
            face.normal[2] * halfExtent + face.u[2] * uu * halfExtent + face.v[2] * vv * halfExtent,
          ];
          const clamped = point.map((value) => Math.max(-inner, Math.min(inner, value)));
          const delta = [
            point[0] - clamped[0],
            point[1] - clamped[1],
            point[2] - clamped[2],
          ];
          const length = Math.hypot(delta[0], delta[1], delta[2]) || 1;
          const normal = delta.map((value) => value / length);
          const rounded = [
            clamped[0] + normal[0] * rounding,
            clamped[1] + normal[1] * rounding,
            clamped[2] + normal[2] * rounding,
          ];
          positions.push(...rounded);
          normals.push(...normal);
        }
      }
      for (let row = 0; row < segments; row += 1) {
        for (let col = 0; col < segments; col += 1) {
          const a = base + row * (segments + 1) + col;
          const b = a + 1;
          const d = a + segments + 1;
          const c = d + 1;
          indices.push(a, b, c, a, c, d);
        }
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
      count: indices.length,
    };
  }

  function createStickerQuad(size = 0.79) {
    const h = size / 2;
    return {
      positions: new Float32Array([
        -h, -h, 0,
        h, -h, 0,
        h, h, 0,
        -h, h, 0,
      ]),
      uvs: new Float32Array([
        -0.5, -0.5,
        0.5, -0.5,
        0.5, 0.5,
        -0.5, 0.5,
      ]),
      normals: new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      count: 6,
    };
  }

  function createPlane() {
    return {
      positions: new Float32Array([
        -1, 0, -1,
        1, 0, -1,
        1, 0, 1,
        -1, 0, 1,
      ]),
      uvs: new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
      count: 6,
    };
  }

  function createFullscreenTriangle() {
    return {
      positions: new Float32Array([-1, -1, 3, -1, -1, 3]),
      count: 3,
    };
  }

  return {
    createRoundedBox,
    createStickerQuad,
    createPlane,
    createFullscreenTriangle,
  };
});
