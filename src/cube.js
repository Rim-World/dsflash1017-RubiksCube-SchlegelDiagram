(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).CubeData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AXES = ["x", "y", "z"];
  const AXIS_INDEX = { x: 0, y: 1, z: 2 };
  const FACE_COLORS = Object.freeze({
    U: "#f2c14e",
    R: "#dd5b49",
    F: "#409b67",
    D: "#f5eddc",
    L: "#f09a40",
    B: "#4068c2",
  });
  const FACE_NAMES = Object.freeze({
    U: "上",
    R: "右",
    F: "前",
    D: "下",
    L: "左",
    B: "后",
  });
  const FACE_NORMALS = Object.freeze({
    U: [0, 1, 0],
    R: [1, 0, 0],
    F: [0, 0, 1],
    D: [0, -1, 0],
    L: [-1, 0, 0],
    B: [0, 0, -1],
  });
  const NORMAL_FACES = Object.freeze({
    "0,1,0": "U",
    "1,0,0": "R",
    "0,0,1": "F",
    "0,-1,0": "D",
    "-1,0,0": "L",
    "0,0,-1": "B",
  });
  const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];

  const CORNER_HOMES = [
    [1, 1, 1],
    [-1, 1, 1],
    [-1, 1, -1],
    [1, 1, -1],
    [1, -1, 1],
    [-1, -1, 1],
    [-1, -1, -1],
    [1, -1, -1],
  ];
  const CORNER_NAMES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
  const EDGE_HOMES = [
    [1, 1, 0],
    [0, 1, 1],
    [-1, 1, 0],
    [0, 1, -1],
    [1, -1, 0],
    [0, -1, 1],
    [-1, -1, 0],
    [0, -1, -1],
    [1, 0, 1],
    [-1, 0, 1],
    [-1, 0, -1],
    [1, 0, -1],
  ];
  const EDGE_NAMES = [
    "UR", "UF", "UL", "UB", "DR", "DF",
    "DL", "DB", "FR", "FL", "BL", "BR",
  ];
  const CENTER_HOMES = [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
    [-1, 0, 0],
    [0, 0, -1],
  ];

  function vectorKey(v) {
    return `${v[0]},${v[1]},${v[2]}`;
  }

  function faceFromNormal(normal) {
    return NORMAL_FACES[vectorKey(normal)];
  }

  function normalFromFace(face) {
    return FACE_NORMALS[face].slice();
  }

  function rotateVector(v, axis, quarterTurns) {
    let [x, y, z] = v;
    let turns = ((quarterTurns % 4) + 4) % 4;
    for (let i = 0; i < turns; i += 1) {
      if (axis === "x") {
        const nextY = -z;
        const nextZ = y;
        y = nextY;
        z = nextZ;
      } else if (axis === "y") {
        const nextX = z;
        const nextZ = -x;
        x = nextX;
        z = nextZ;
      } else {
        const nextX = -y;
        const nextY = x;
        x = nextX;
        y = nextY;
      }
    }
    return [x, y, z];
  }

  function multiplyMatrix3(a, b) {
    const out = new Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        for (let k = 0; k < 3; k += 1) {
          out[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
        }
      }
    }
    return out;
  }

  function applyMatrix3(matrix, v) {
    return [
      matrix[0] * v[0] + matrix[1] * v[1] + matrix[2] * v[2],
      matrix[3] * v[0] + matrix[4] * v[1] + matrix[5] * v[2],
      matrix[6] * v[0] + matrix[7] * v[1] + matrix[8] * v[2],
    ];
  }

  function matrixForQuarter(axis, quarterTurns) {
    const ex = rotateVector([1, 0, 0], axis, quarterTurns);
    const ey = rotateVector([0, 1, 0], axis, quarterTurns);
    const ez = rotateVector([0, 0, 1], axis, quarterTurns);
    return [
      ex[0], ey[0], ez[0],
      ex[1], ey[1], ez[1],
      ex[2], ey[2], ez[2],
    ];
  }

  function faceRowCol(face, pos) {
    const [x, y, z] = pos;
    if (face === "U") return { row: z + 1, col: x + 1 };
    if (face === "D") return { row: 1 - z, col: x + 1 };
    if (face === "F") return { row: 1 - y, col: x + 1 };
    if (face === "B") return { row: 1 - y, col: 1 - x };
    if (face === "R") return { row: 1 - y, col: 1 - z };
    return { row: 1 - y, col: z + 1 };
  }

  function rowColPosition(face, row, col) {
    if (face === "U") return [col - 1, 1, row - 1];
    if (face === "D") return [col - 1, -1, 1 - row];
    if (face === "F") return [col - 1, 1 - row, 1];
    if (face === "B") return [1 - col, 1 - row, -1];
    if (face === "R") return [1, 1 - row, 1 - col];
    return [-1, 1 - row, col - 1];
  }

  function slotKey(face, row, col) {
    return `${face}${row}${col}`;
  }

  function slotKeyFromSticker(sticker) {
    const normal = applyMatrix3(sticker.cubie.orientation, sticker.local);
    const face = faceFromNormal(normal);
    const { row, col } = faceRowCol(face, sticker.cubie.position);
    return slotKey(face, row, col);
  }

  function makeCubie(kind, home, homeIndex) {
    const position = home.slice();
    const stickers = [];
    for (let index = 0; index < 3; index += 1) {
      if (home[index] === 0) continue;
      const local = [0, 0, 0];
      local[index] = home[index];
      stickers.push({
        id: `${kind}-${homeIndex}-${index}`,
        local,
        color: FACE_COLORS[faceFromNormal(local)],
        homeFace: faceFromNormal(local),
        cubie: null,
      });
    }
    return {
      id: `${kind}-${homeIndex}`,
      kind,
      homeIndex,
      home: home.slice(),
      position,
      orientation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      stickers,
    };
  }

  class Cube {
    constructor(cubies) {
      this.cubies = cubies || Cube.makeSolvedCubies();
      for (const cubie of this.cubies) {
        for (const sticker of cubie.stickers) sticker.cubie = cubie;
      }
    }

    static makeSolvedCubies() {
      const cubies = [];
      CORNER_HOMES.forEach((home, index) => cubies.push(makeCubie("corner", home, index)));
      EDGE_HOMES.forEach((home, index) => cubies.push(makeCubie("edge", home, index)));
      CENTER_HOMES.forEach((home, index) => cubies.push(makeCubie("center", home, index)));
      return cubies;
    }

    static solved() {
      return new Cube();
    }

    clone() {
      const cubies = this.cubies.map((cubie) => ({
        ...cubie,
        home: cubie.home.slice(),
        position: cubie.position.slice(),
        orientation: cubie.orientation.slice(),
        stickers: cubie.stickers.map((sticker) => ({
          ...sticker,
          local: sticker.local.slice(),
          cubie: null,
        })),
      }));
      return new Cube(cubies);
    }

    rotateLayer(axis, layers, quarterTurns) {
      const layerSet = new Set(layers);
      const key = AXIS_INDEX[axis];
      for (const cubie of this.cubies) {
        if (!layerSet.has(cubie.position[key])) continue;
        cubie.position = rotateVector(cubie.position, axis, quarterTurns);
        cubie.orientation = multiplyMatrix3(
          matrixForQuarter(axis, quarterTurns),
          cubie.orientation,
        );
      }
      return this;
    }

    applyMove(move) {
      return this.rotateLayer(move.axis, move.layers, move.angle);
    }

    applyMoves(moves) {
      for (const move of moves) this.applyMove(move);
      return this;
    }

    isLayerMove() {
      return this.cubies.length === 26;
    }

    stickers() {
      const result = [];
      for (const cubie of this.cubies) {
        for (const sticker of cubie.stickers) {
          sticker.cubie = cubie;
          result.push(sticker);
        }
      }
      return result;
    }

    stickerTable() {
      const table = Object.create(null);
      for (const sticker of this.stickers()) {
        const normal = applyMatrix3(sticker.cubie.orientation, sticker.local);
        const face = faceFromNormal(normal);
        const { row, col } = faceRowCol(face, sticker.cubie.position);
        table[slotKey(face, row, col)] = {
          sticker,
          color: sticker.color,
          face,
          row,
          col,
          normal,
          position: sticker.cubie.position.slice(),
        };
      }
      return table;
    }

    stickerNodeIds(mapping) {
      const result = new Array(54).fill(null);
      const table = this.stickerTable();
      for (const entry of mapping.nodes) {
        const stickerEntry = table[entry.slotKey];
        if (stickerEntry) {
          stickerEntry.sticker.nodeIndex = entry.index;
          result[entry.index] = stickerEntry.sticker;
        }
      }
      return result;
    }

    faceColors() {
      const result = { U: [], R: [], F: [], D: [], L: [], B: [] };
      const table = this.stickerTable();
      for (const entry of Object.values(table)) {
        result[entry.face].push(entry.color);
      }
      return result;
    }

    isFaceSolved() {
      const colors = this.faceColors();
      return FACE_ORDER.every((face) => {
        const values = colors[face];
        return values.length === 9 && values.every((color) => color === values[0]);
      });
    }

    isSolved() {
      const table = this.stickerTable();
      for (const entry of Object.values(table)) {
        if (entry.color !== FACE_COLORS[entry.face]) return false;
      }
      return this.centersAligned();
    }

    centersAligned() {
      for (const cubie of this.cubies) {
        if (cubie.kind !== "center") continue;
        const normal = applyMatrix3(cubie.orientation, cubie.stickers[0].local);
        const face = faceFromNormal(normal);
        if (face !== cubie.stickers[0].homeFace) return false;
        const homeFace = FACE_ORDER[cubie.homeIndex];
        if (face !== homeFace) return false;
      }
      return true;
    }

    centerColorAt(face) {
      for (const cubie of this.cubies) {
        if (cubie.kind !== "center") continue;
        const { row, col } = faceRowCol(face, cubie.position);
        if (row === 1 && col === 1) {
          const normal = applyMatrix3(cubie.orientation, cubie.stickers[0].local);
          if (faceFromNormal(normal) === face) return cubie.stickers[0];
        }
      }
      return null;
    }

    centerSignature() {
      return FACE_ORDER.map((face) => {
        const sticker = this.centerColorAt(face);
        return sticker ? sticker.homeFace : "?";
      }).join("");
    }
  }

  function describeTurn(move) {
    const axisNames = { x: "右轴", y: "上轴", z: "前轴" };
    const quarter = ((move.angle % 4) + 4) % 4;
    const amount = quarter === 2 ? "180°" : "90°";
    if (move.layers.length === 3 && move.name && /^[xyz]/.test(move.name)) {
      const rotationNames = {
        x: "整体向右翻滚",
        y: "整体水平旋转",
        z: "整体向前翻滚",
      };
      const base = move.name.replace(/['2]/g, "");
      const direction = quarter === 2 ? "" : (move.angle > 0 ? "顺时针" : "逆时针");
      return `${rotationNames[base]}${direction} · ${amount}`;
    }
    if (move.name === "M" || move.name === "M'" || move.name === "M2") {
      return `中层随左面${quarter === 2 ? "" : (move.angle < 0 ? "顺时针" : "逆时针")} · ${amount}`;
    }
    if (move.name === "E" || move.name === "E'" || move.name === "E2") {
      return `中层随底面${quarter === 2 ? "" : (move.angle < 0 ? "顺时针" : "逆时针")} · ${amount}`;
    }
    if (move.name === "S" || move.name === "S'" || move.name === "S2") {
      return `中层随前面${quarter === 2 ? "" : (move.angle > 0 ? "顺时针" : "逆时针")} · ${amount}`;
    }
    if (move.face) {
      const faceClockwise =
        move.angle * (move.face === "D" || move.face === "L" || move.face === "B" ? -1 : 1) > 0;
      const direction = quarter === 2 ? "半周" : (faceClockwise ? "顺时针" : "逆时针");
      const wide = move.wide ? "双层" : "";
      return `${wide}${move.faceLabel}面${direction} · ${amount}`;
    }
    return `${axisNames[move.axis] || "转层"} · ${amount}`;
  }

  const FACE_MOVE_DEFS = {
    U: { axis: "y", layers: [1], angle: 1, face: "U" },
    R: { axis: "x", layers: [1], angle: 1, face: "R" },
    F: { axis: "z", layers: [1], angle: 1, face: "F" },
    D: { axis: "y", layers: [-1], angle: -1, face: "D" },
    L: { axis: "x", layers: [-1], angle: -1, face: "L" },
    B: { axis: "z", layers: [-1], angle: -1, face: "B" },
  };

  const SLICE_DEFS = {
    M: { axis: "x", layers: [0], angle: -1 },
    E: { axis: "y", layers: [0], angle: -1 },
    S: { axis: "z", layers: [0], angle: 1 },
  };

  function makeMove(base, suffix, wide = false) {
    let angle = base.angle;
    if (suffix === "'") angle = -angle;
    else if (suffix === "2") angle = Math.abs(angle) * 2;
    const move = {
      ...base,
      layers: base.layers.slice(),
      angle,
      wide,
    };
    if (base.face) {
      move.name = `${base.face}${wide ? "w" : ""}${suffix}`;
      move.faceLabel = FACE_NAMES[base.face];
    } else if (base.slice) {
      move.name = `${base.slice}${suffix}`;
    } else {
      move.name = `${base.rotation}${suffix}`;
    }
    move.direction = angle === 2 || angle === -2 ? 2 : Math.sign(angle);
    move.notation = move.name;
    move.label = describeTurn(move);
    return move;
  }

  function parseMove(token) {
    const match = String(token).trim().match(/^([URFDLBMESxyz])(w?)('?2?)$/);
    if (!match) throw new Error(`无法识别转动：${token}`);
    const letter = match[1];
    const wide = match[2] === "w";
    const suffix = match[3] || "";
    if (FACE_MOVE_DEFS[letter]) {
      const base = FACE_MOVE_DEFS[letter];
      if (wide) {
        return makeMove({
          ...base,
          layers: [base.layers[0], 0],
        }, suffix, true);
      }
      return makeMove(base, suffix, false);
    }
    if (SLICE_DEFS[letter]) {
      return makeMove({ ...SLICE_DEFS[letter], slice: letter }, suffix, false);
    }
    const rotation = letter;
    const axis = rotation;
    const sign = axis === "z" ? 1 : 1;
    return makeMove({
      axis,
      layers: [-1, 0, 1],
      angle: sign,
      rotation,
    }, suffix, false);
  }

  function parseSequence(text) {
    return String(text)
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map(parseMove);
  }

  function inverseMove(move) {
    const desired = normalizeAngleForNotation(-move.angle);
    if (Math.abs(desired) === 2) {
      const token = move.rotation || move.slice || `${move.face}${move.wide ? "w" : ""}`;
      return parseMove(`${token}2`);
    }
    const baseAngle = move.rotation
      ? 1
      : move.slice
        ? (move.slice === "S" ? 1 : -1)
        : (move.face === "D" || move.face === "L" || move.face === "B" ? -1 : 1);
    const token = move.rotation || move.slice || `${move.face}${move.wide ? "w" : ""}`;
    return parseMove(`${token}${desired === baseAngle ? "" : "'"}`);
  }

  function normalizeAngleForNotation(angle) {
    if (angle === 2 || angle === -2) return 2;
    let result = ((angle % 4) + 4) % 4;
    if (result === 3) result = -1;
    return result;
  }

  const ALL_MOVES = [];
  for (const face of ["U", "R", "F", "D", "L", "B"]) {
    for (const suffix of ["", "'", "2"]) {
      ALL_MOVES.push(parseMove(`${face}${suffix}`));
      ALL_MOVES.push(parseMove(`${face}w${suffix}`));
    }
  }
  for (const slice of ["M", "E", "S"]) {
    for (const suffix of ["", "'", "2"]) ALL_MOVES.push(parseMove(`${slice}${suffix}`));
  }
  for (const rotation of ["x", "y", "z"]) {
    for (const suffix of ["", "'", "2"]) ALL_MOVES.push(parseMove(`${rotation}${suffix}`));
  }

  function moveKey(move) {
    return move.name;
  }

  function randomScramble(length = 24, rng = Math.random) {
    const faceTokens = ["U", "D", "R", "L", "F", "B"];
    const suffixes = ["", "'", "2"];
    const result = [];
    let lastFace = "";
    let beforeLastFace = "";
    while (result.length < length) {
      const face = faceTokens[Math.floor(rng() * faceTokens.length)];
      if (face === lastFace) continue;
      const axis = FACE_MOVE_DEFS[face].axis;
      const lastAxis = lastFace ? FACE_MOVE_DEFS[lastFace].axis : "";
      const beforeAxis = beforeLastFace ? FACE_MOVE_DEFS[beforeLastFace].axis : "";
      if (axis === lastAxis && axis === beforeAxis) continue;
      const suffix = suffixes[Math.floor(rng() * suffixes.length)];
      result.push(face + suffix);
      beforeLastFace = lastFace;
      lastFace = face;
    }
    return result;
  }

  function scrambleCube(length = 24, rng = Math.random) {
    const tokens = randomScramble(length, rng);
    return {
      tokens,
      cube: Cube.solved().applyMoves(parseSequence(tokens.join(" "))),
    };
  }

  return {
    AXES,
    AXIS_INDEX,
    FACE_COLORS,
    FACE_NAMES,
    FACE_NORMALS,
    FACE_ORDER,
    CORNER_HOMES,
    CORNER_NAMES,
    EDGE_HOMES,
    EDGE_NAMES,
    CENTER_HOMES,
    Cube,
    rotateVector,
    matrixForQuarter,
    applyMatrix3,
    faceFromNormal,
    normalFromFace,
    faceRowCol,
    rowColPosition,
    slotKey,
    slotKeyFromSticker,
    parseMove,
    parseSequence,
    inverseMove,
    FACE_MOVE_DEFS,
    ALL_MOVES,
    moveKey,
    randomScramble,
    scrambleCube,
    describeTurn,
  };
});
