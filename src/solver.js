(function (root, factory) {
  const deps = typeof module === "object" && module.exports
    ? { CubeData: require("./cube.js"), Algs: require("./algs.js") }
    : { CubeData: root.CubeLab.CubeData, Algs: root.CubeLab.Algs };
  const api = factory(deps.CubeData, deps.Algs);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).Solver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CubeData, Algs) {
  "use strict";

  const {
    Cube,
    CORNER_HOMES,
    EDGE_HOMES,
    applyMatrix3,
    rotateVector,
    parseMove,
    parseSequence,
  } = CubeData;
  const FACES = ["U", "R", "F", "D", "L", "B"];
  const FACE_ORDER_INDEX = { U: 0, D: 1, R: 2, L: 3, F: 4, B: 5 };
  const FACE_AXIS = { U: "y", R: "x", F: "z", D: "y", L: "x", B: "z" };
  const FACE_LAYER = { U: 1, R: 1, F: 1, D: -1, L: -1, B: -1 };
  const FACE_SIGN = { U: 1, R: 1, F: 1, D: -1, L: -1, B: -1 };
  const SOLVED_CP = [0, 1, 2, 3, 4, 5, 6, 7];
  const SOLVED_EP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const SOLVED_MASK = 0x0f00;
  const CO_SIZE = 2187;
  const EO_SIZE = 2048;
  const SLICE_COMB_COUNT = 495;
  const CP_SIZE = 40320;
  const SLICE_PERM_SIZE = 24;
  const FACT = (() => {
    const result = [1];
    for (let i = 1; i <= 12; i += 1) result[i] = result[i - 1] * i;
    return result;
  })();
  const CORNER_DIRECTIONS = [
    [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [0, 0, 1], [-1, 0, 0]],
    [[0, 1, 0], [-1, 0, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, -1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [-1, 0, 0], [0, 0, 1]],
    [[0, -1, 0], [0, 0, -1], [-1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  ];
  const EDGE_DIRECTIONS = [
    [[0, 1, 0], [1, 0, 0]],
    [[0, 1, 0], [0, 0, 1]],
    [[0, 1, 0], [-1, 0, 0]],
    [[0, 1, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0]],
    [[0, -1, 0], [0, 0, 1]],
    [[0, -1, 0], [-1, 0, 0]],
    [[0, -1, 0], [0, 0, -1]],
    [[0, 0, 1], [1, 0, 0]],
    [[0, 0, 1], [-1, 0, 0]],
    [[0, 0, -1], [-1, 0, 0]],
    [[0, 0, -1], [1, 0, 0]],
  ];

  const TOKEN_SPECS = [];
  for (const face of FACES) {
    TOKEN_SPECS.push({ token: face, face, quarter: 1 });
    TOKEN_SPECS.push({ token: `${face}2`, face, quarter: 2 });
    TOKEN_SPECS.push({ token: `${face}'`, face, quarter: -1 });
  }
  const PHASE2_TOKENS = [
    "U", "U2", "U'",
    "D", "D2", "D'",
    "R2", "F2", "L2", "B2",
  ].map((token) => TOKEN_SPECS.find((spec) => spec.token === token));

  function positionIndex(value) {
    return value ? `${value[0]},${value[1]},${value[2]}` : "";
  }

  function matrixFromRotation(axis, quarterTurns) {
    const ex = rotateVector([1, 0, 0], axis, quarterTurns);
    const ey = rotateVector([0, 1, 0], axis, quarterTurns);
    const ez = rotateVector([0, 0, 1], axis, quarterTurns);
    return [
      ex[0], ey[0], ez[0],
      ex[1], ey[1], ez[1],
      ex[2], ey[2], ez[2],
    ];
  }

  function directionIndex(directions, vector) {
    for (let index = 0; index < directions.length; index += 1) {
      const direction = directions[index];
      if (
        direction[0] * vector[0] +
        direction[1] * vector[1] +
        direction[2] * vector[2] > 0.5
      ) return index;
    }
    return 0;
  }

  function cornerOrientation(matrix, position, home) {
    const uSticker = applyMatrix3(matrix, [0, home[1], 0]);
    const positionIndexValue = CORNER_HOMES.findIndex(
      (candidate) => candidate.every((value, index) => value === position[index]),
    );
    return directionIndex(CORNER_DIRECTIONS[positionIndexValue], uSticker);
  }

  function edgeHomeIsSlice(home) {
    return home[1] === 0;
  }

  function edgeOrientation(matrix, home, position) {
    let reference;
    if (home[1] !== 0) {
      reference = applyMatrix3(matrix, [0, home[1], 0]);
    } else {
      reference = applyMatrix3(matrix, [0, 0, home[2]]);
    }
    const positionIndexValue = EDGE_HOMES.findIndex(
      (candidate) => candidate.every((value, index) => value === position[index]),
    );
    const first = EDGE_DIRECTIONS[positionIndexValue][0];
    return first[0] * reference[0] + first[1] * reference[1] + first[2] * reference[2] > 0.5
      ? 0
      : 1;
  }

  function buildFaceMechanics() {
    const cornerPositionLookup = new Map(CORNER_HOMES.map((home, index) => [positionIndex(home), index]));
    const edgePositionLookup = new Map(EDGE_HOMES.map((home, index) => [positionIndex(home), index]));
    const mechanics = {};
    for (const face of FACES) {
      const axis = FACE_AXIS[face];
      const layer = FACE_LAYER[face];
      const sign = FACE_SIGN[face];
      const quarterTurns = sign;
      const cpPerm = new Array(8);
      const epPerm = new Array(12);
      const coMaps = Array.from({ length: 8 }, () => [0, 1, 2]);
      const edgeLayer = new Array(12).fill(false);
      const eoDelta = new Array(12).fill(0);
      for (let source = 0; source < 8; source += 1) {
        const home = CORNER_HOMES[source];
        if (home[["x", "y", "z"].indexOf(axis)] !== layer) {
          cpPerm[source] = source;
          continue;
        }
        const destinationPosition = rotateVector(home, axis, quarterTurns);
        const destination = cornerPositionLookup.get(positionIndex(destinationPosition));
        cpPerm[source] = destination;
        for (let oldOrientation = 0; oldOrientation < 3; oldOrientation += 1) {
          const direction = CORNER_DIRECTIONS[source][oldOrientation];
          const rotated = rotateVector(direction, axis, quarterTurns);
          coMaps[source][oldOrientation] = directionIndex(
            CORNER_DIRECTIONS[destination],
            rotated,
          );
        }
      }
      for (let source = 0; source < 12; source += 1) {
        const home = EDGE_HOMES[source];
        if (home[["x", "y", "z"].indexOf(axis)] !== layer) {
          epPerm[source] = source;
          continue;
        }
        edgeLayer[source] = true;
        const destinationPosition = rotateVector(home, axis, quarterTurns);
        epPerm[source] = edgePositionLookup.get(positionIndex(destinationPosition));
        eoDelta[source] = axis === "z" ? 1 : 0;
      }
      mechanics[face] = { cpPerm, epPerm, coMaps, eoDelta, edgeLayer, axis };
    }
    return mechanics;
  }

  const MECHANICS = buildFaceMechanics();

  function applyFaceOnce(state, face) {
    const mechanic = MECHANICS[face];
    const cp = state.cp.slice();
    const co = state.co.slice();
    const ep = state.ep.slice();
    const eo = state.eo.slice();
    for (let source = 0; source < 8; source += 1) {
      const destination = mechanic.cpPerm[source];
      state.cp[destination] = cp[source];
      state.co[destination] = mechanic.coMaps[source][co[source]];
    }
    for (let source = 0; source < 12; source += 1) {
      const destination = mechanic.epPerm[source];
      state.ep[destination] = ep[source];
      state.eo[destination] = (eo[source] ^ mechanic.eoDelta[source]) >>> 0;
    }
    return state;
  }

  function applyTokenToState(state, spec) {
    let turns = spec.quarter;
    if (turns === 2) {
      applyFaceOnce(state, spec.face);
      applyFaceOnce(state, spec.face);
      return state;
    }
    if (turns === -1) turns = 3;
    for (let i = 0; i < turns; i += 1) applyFaceOnce(state, spec.face);
    return state;
  }

  function redundantPair(previousFace, nextFace) {
    if (!previousFace) return false;
    if (previousFace === nextFace) return true;
    if (FACE_AXIS[previousFace] !== FACE_AXIS[nextFace]) return false;
    return FACE_ORDER_INDEX[nextFace] < FACE_ORDER_INDEX[previousFace];
  }

  function snapshotCubieState(cube) {
    const cp = new Array(8);
    const co = new Array(8);
    const ep = new Array(12);
    const eo = new Array(12);
    const cornerPositions = new Map();
    const edgePositions = new Map();
    for (const cubie of cube.cubies) {
      const key = positionIndex(cubie.position);
      if (cubie.kind === "corner") cornerPositions.set(key, cubie);
      else if (cubie.kind === "edge") edgePositions.set(key, cubie);
    }
    for (let position = 0; position < 8; position += 1) {
      const home = CORNER_HOMES[position];
      const cubie = cornerPositions.get(positionIndex(home));
      if (!cubie) throw new Error("角块位置不完整。");
      cp[position] = cubie.homeIndex;
      co[position] = cornerOrientation(cubie.orientation, cubie.position, cubie.home);
    }
    for (let position = 0; position < 12; position += 1) {
      const home = EDGE_HOMES[position];
      const cubie = edgePositions.get(positionIndex(home));
      if (!cubie) throw new Error("棱块位置不完整。");
      ep[position] = cubie.homeIndex;
      eo[position] = edgeOrientation(cubie.orientation, cubie.home, cubie.position);
    }
    return { cp, co, ep, eo };
  }

  function permutationRank(values) {
    let rank = 0;
    for (let i = 0; i < values.length; i += 1) {
      let smaller = 0;
      for (let j = i + 1; j < values.length; j += 1) {
        if (values[j] < values[i]) smaller += 1;
      }
      rank += smaller * FACT[values.length - 1 - i];
    }
    return rank;
  }

  function permutationUnrank(rank, length, offset = 0) {
    const available = Array.from({ length }, (_, index) => index + offset);
    const result = [];
    let remaining = rank;
    for (let position = 0; position < length; position += 1) {
      const factorial = FACT[length - 1 - position];
      const index = Math.floor(remaining / factorial);
      remaining %= factorial;
      result.push(available.splice(index, 1)[0]);
    }
    return result;
  }

  function encodeCO(co) {
    let rank = 0;
    for (let i = 0; i < 7; i += 1) rank = rank * 3 + co[i];
    return rank;
  }

  function decodeCO(rank) {
    const result = new Array(8).fill(0);
    let remaining = rank;
    let sum = 0;
    for (let i = 6; i >= 0; i -= 1) {
      result[i] = remaining % 3;
      sum += result[i];
      remaining = Math.floor(remaining / 3);
    }
    result[7] = (3 - (sum % 3)) % 3;
    return result;
  }

  function encodeEO(eo) {
    let rank = 0;
    for (let i = 0; i < 11; i += 1) rank = rank * 2 + eo[i];
    return rank;
  }

  function decodeEO(rank) {
    const result = new Array(12).fill(0);
    let remaining = rank;
    let parity = 0;
    for (let i = 10; i >= 0; i -= 1) {
      result[i] = remaining % 2;
      parity ^= result[i];
      remaining = Math.floor(remaining / 2);
    }
    result[11] = parity;
    return result;
  }

  const SLICE_MASKS = [];
  const SLICE_RANKS = new Uint16Array(4096);
  for (let mask = 0; mask < 4096; mask += 1) {
    let count = 0;
    for (let i = 0; i < 12; i += 1) if (mask & (1 << i)) count += 1;
    if (count === 4) {
      SLICE_RANKS[mask] = SLICE_MASKS.length;
      SLICE_MASKS.push(mask);
    } else {
      SLICE_RANKS[mask] = 65535;
    }
  }

  function sliceMaskFromEP(ep) {
    let mask = 0;
    for (let position = 0; position < 12; position += 1) {
      if (ep[position] >= 8) mask |= 1 << position;
    }
    return mask;
  }

  function slicePermutation(ep) {
    return ep.slice(8, 12).map((value) => value - 8);
  }

  function moveSliceMask(mask, mechanic) {
    let result = 0;
    for (let source = 0; source < 12; source += 1) {
      if (!(mask & (1 << source))) continue;
      result |= 1 << mechanic.epPerm[source];
    }
    return result;
  }

  function buildCoordinateMoves() {
    const coMoves = [];
    const eoPerms = [];
    const flipRanks = [];
    const maskMoves = [];
    for (const spec of TOKEN_SPECS) {
      const co = new Array(CO_SIZE);
      for (let rank = 0; rank < CO_SIZE; rank += 1) {
        const state = { cp: SOLVED_CP.slice(), co: decodeCO(rank), ep: SOLVED_EP.slice(), eo: new Array(12).fill(0) };
        applyTokenToState(state, spec);
        co[rank] = encodeCO(state.co);
      }
      const mechanic = MECHANICS[spec.face];
      const repetitions = spec.quarter === -1 ? 3 : spec.quarter;
      let fullPerm = Array.from({ length: 12 }, (_, index) => index);
      for (let turn = 0; turn < repetitions; turn += 1) {
        const next = new Array(12);
        for (let source = 0; source < 12; source += 1) {
          next[source] = mechanic.epPerm[fullPerm[source]];
        }
        fullPerm = next;
      }
      const eo = new Uint16Array(EO_SIZE);
      for (let rank = 0; rank < EO_SIZE; rank += 1) {
        const input = decodeEO(rank);
        const output = new Array(12);
        for (let source = 0; source < 12; source += 1) {
          output[fullPerm[source]] = input[source];
        }
        eo[rank] = encodeEO(output);
      }
      const masks = new Uint16Array(4096).fill(65535);
      const flips = new Uint16Array(4096);
      for (const mask of SLICE_MASKS) {
        let nextMask = 0;
        let flipBits = 0;
        for (let source = 0; source < 12; source += 1) {
          if (mask & (1 << source)) nextMask |= 1 << fullPerm[source];
          const flipsOnce = mechanic.edgeLayer[source] && mechanic.axis === "z" ? 1 : 0;
          const flip = (flipsOnce * repetitions) % 2;
          if (flip && fullPerm[source] < 11) flipBits |= 1 << (10 - fullPerm[source]);
        }
        masks[mask] = nextMask;
        flips[mask] = flipBits;
      }
      coMoves.push(Uint16Array.from(co));
      eoPerms.push(eo);
      flipRanks.push(flips);
      maskMoves.push(masks);
    }
    return { coMoves, eoPerms, flipRanks, maskMoves };
  }

  function buildPhase2CoordinateMoves() {
    const cpMoves = [];
    const epMoves = [];
    const sliceMoves = [];
    for (const spec of PHASE2_TOKENS) {
      const cp = new Array(CP_SIZE);
      const ep = new Array(CP_SIZE);
      for (let rank = 0; rank < CP_SIZE; rank += 1) {
        const cpValues = permutationUnrank(rank, 8);
        const epValues = permutationUnrank(rank, 8);
        const cpState = {
          cp: cpValues,
          co: new Array(8).fill(0),
          ep: SOLVED_EP.slice(),
          eo: new Array(12).fill(0),
        };
        applyTokenToState(cpState, spec);
        cp[rank] = permutationRank(cpState.cp);
        const epState = {
          cp: SOLVED_CP.slice(),
          co: new Array(8).fill(0),
          ep: [...epValues, 8, 9, 10, 11],
          eo: new Array(12).fill(0),
        };
        applyTokenToState(epState, spec);
        ep[rank] = permutationRank(epState.ep.slice(0, 8));
      }
      cpMoves.push(Uint16Array.from(cp));
      epMoves.push(Uint16Array.from(ep));
      const slice = new Uint8Array(SLICE_PERM_SIZE);
      for (let rank = 0; rank < SLICE_PERM_SIZE; rank += 1) {
        const values = permutationUnrank(rank, 4, 8);
        const state = {
          cp: SOLVED_CP.slice(),
          co: new Array(8).fill(0),
          ep: [...SOLVED_EP.slice(0, 8), ...values],
          eo: new Array(12).fill(0),
        };
        applyTokenToState(state, spec);
        slice[rank] = permutationRank(slicePermutation(state.ep));
      }
      sliceMoves.push(slice);
    }
    return { cpMoves, epMoves, sliceMoves };
  }

  const COORDINATE_MOVES = buildCoordinateMoves();
  const PHASE2_COORDINATE_MOVES = buildPhase2CoordinateMoves();

  async function buildDistanceTable(total, transition, goal, onProgress, yieldEvery = 55000) {
    const distances = new Uint8Array(total);
    distances.fill(255);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    distances[goal] = 0;
    queue[tail++] = goal;
    let lastYield = 0;
    while (head < tail) {
      const current = queue[head++];
      const nextDistance = distances[current] + 1;
      for (let move = 0; move < transition.length; move += 1) {
        const neighbor = transition[move](current);
        if (distances[neighbor] !== 255) continue;
        distances[neighbor] = nextDistance;
        queue[tail++] = neighbor;
      }
      if (onProgress && head - lastYield >= yieldEvery) {
        lastYield = head;
        onProgress(total ? head / total : 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return distances;
  }

  function buildPhase1Transitions(kind) {
    const result = [];
    const moves = kind === "co" ? COORDINATE_MOVES.coMoves : COORDINATE_MOVES.eoPerms;
    const flips = COORDINATE_MOVES.flipRanks;
    for (let m = 0; m < TOKEN_SPECS.length; m += 1) {
      const coordMoves = moves[m];
      const maskMoves = COORDINATE_MOVES.maskMoves[m];
      if (kind === "co") {
        result.push((index) => {
          const coord = Math.floor(index / SLICE_COMB_COUNT);
          const slice = index % SLICE_COMB_COUNT;
          const mask = maskMoves[SLICE_MASKS[slice]];
          return coordMoves[coord] * SLICE_COMB_COUNT + SLICE_RANKS[mask];
        });
      } else {
        result.push((index) => {
          const coord = Math.floor(index / SLICE_COMB_COUNT);
          const slice = index % SLICE_COMB_COUNT;
          const oldMask = SLICE_MASKS[slice];
          const mask = maskMoves[oldMask];
          const orientation = coordMoves[coord] ^ flips[m][oldMask];
          return orientation * SLICE_COMB_COUNT + SLICE_RANKS[mask];
        });
      }
    }
    return result;
  }

  function buildPhase2Transitions(kind) {
    const moves = kind === "cp"
      ? PHASE2_COORDINATE_MOVES.cpMoves
      : PHASE2_COORDINATE_MOVES.epMoves;
    const result = [];
    for (let m = 0; m < PHASE2_TOKENS.length; m += 1) {
      const coordMoves = moves[m];
      const sliceMoves = PHASE2_COORDINATE_MOVES.sliceMoves[m];
      result.push((index) => {
        const coord = Math.floor(index / SLICE_PERM_SIZE);
        const slice = index % SLICE_PERM_SIZE;
        return coordMoves[coord] * SLICE_PERM_SIZE + sliceMoves[slice];
      });
    }
    return result;
  }

  function frameRotationMoves(cube) {
    if (cube.centersAligned()) return [];
    const rotations = ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"];
    const queue = [{ cube: cube.clone(), path: [] }];
    const seen = new Set([cube.centerSignature()]);
    while (queue.length) {
      const item = queue.shift();
      if (item.path.length >= 3) continue;
      for (const token of rotations) {
        const next = item.cube.clone();
        next.applyMove(parseMove(token));
        const signature = next.centerSignature();
        if (seen.has(signature)) continue;
        seen.add(signature);
        const path = item.path.concat(token);
        if (next.centersAligned()) return path;
        queue.push({ cube: next, path });
      }
    }
    throw new Error("中心块朝向无法通过整体转动摆正。");
  }

  class TwoPhaseSolver {
    constructor() {
      this.ready = false;
      this.preparing = null;
      this.tables = null;
      this.progress = 0;
    }

    async prepare(onProgress) {
      if (this.ready) return;
      if (this.preparing) return this.preparing;
      this.preparing = (async () => {
        const start = typeof performance !== "undefined" ? performance.now() : Date.now();
        const phase1CO = buildPhase1Transitions("co");
        const phase1EO = buildPhase1Transitions("eo");
        const phase2CP = buildPhase2Transitions("cp");
        const phase2EP = buildPhase2Transitions("ep");
        const tasks = [
          () => buildDistanceTable(
            CO_SIZE * SLICE_COMB_COUNT,
            phase1CO,
            SLICE_RANKS[SOLVED_MASK],
            (p) => onProgress && onProgress(0.02 + p * 0.26),
          ),
          () => buildDistanceTable(
            EO_SIZE * SLICE_COMB_COUNT,
            phase1EO,
            SLICE_RANKS[SOLVED_MASK],
            (p) => onProgress && onProgress(0.28 + p * 0.24),
          ),
          () => buildDistanceTable(
            CP_SIZE * SLICE_PERM_SIZE,
            phase2CP,
            permutationRank([0, 1, 2, 3]) * SLICE_PERM_SIZE,
            (p) => onProgress && onProgress(0.52 + p * 0.24),
          ),
          () => buildDistanceTable(
            CP_SIZE * SLICE_PERM_SIZE,
            phase2EP,
            permutationRank([0, 1, 2, 3]) * SLICE_PERM_SIZE,
            (p) => onProgress && onProgress(0.76 + p * 0.24),
          ),
        ];
        const results = [];
        for (const task of tasks) results.push(await task());
        this.tables = {
          phase1CO: results[0],
          phase1EO: results[1],
          phase2CP: results[2],
          phase2EP: results[3],
        };
        this.ready = true;
        this.progress = 1;
        if (onProgress) onProgress(1);
        this.prepareMilliseconds = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
      })();
      return this.preparing;
    }

    phase1Heuristic(state) {
      const coRank = encodeCO(state.co);
      const eoRank = encodeEO(state.eo);
      return this.phase1HeuristicCoords(coRank, eoRank, sliceMaskFromEP(state.ep));
    }

    phase1HeuristicCoords(coRank, eoRank, mask) {
      const slice = SLICE_RANKS[mask];
      return Math.max(
        this.tables.phase1CO[coRank * SLICE_COMB_COUNT + slice],
        this.tables.phase1EO[eoRank * SLICE_COMB_COUNT + slice],
      );
    }

    phase2Heuristic(state) {
      const cpRank = permutationRank(state.cp);
      const epRank = permutationRank(state.ep.slice(0, 8));
      const sliceRank = permutationRank(slicePermutation(state.ep));
      return this.phase2HeuristicCoords(cpRank, epRank, sliceRank);
    }

    phase2HeuristicCoords(cpRank, epRank, sliceRank) {
      return Math.max(
        this.tables.phase2CP[cpRank * SLICE_PERM_SIZE + sliceRank],
        this.tables.phase2EP[epRank * SLICE_PERM_SIZE + sliceRank],
      );
    }

    isPhase1Goal(state) {
      return encodeCO(state.co) === 0 &&
        encodeEO(state.eo) === 0 &&
        sliceMaskFromEP(state.ep) === SOLVED_MASK;
    }

    isPhase2Goal(state) {
      return permutationRank(state.cp) === 0 &&
        permutationRank(state.ep.slice(0, 8)) === 0 &&
        slicePermutation(state.ep).every((value, index) => value === index);
    }

    phase2Search(cpRank, epRank, sliceRank, bound, path, lastFace) {
      const heuristic = this.phase2HeuristicCoords(cpRank, epRank, sliceRank);
      if (heuristic > bound) return null;
      if (bound === 0) {
        return cpRank === 0 && epRank === 0 && sliceRank === 0 ? path.slice() : null;
      }
      for (let moveIndex = 0; moveIndex < PHASE2_TOKENS.length; moveIndex += 1) {
        const spec = PHASE2_TOKENS[moveIndex];
        if (redundantPair(lastFace, spec.face)) continue;
        path.push(spec.token);
        const result = this.phase2Search(
          PHASE2_COORDINATE_MOVES.cpMoves[moveIndex][cpRank],
          PHASE2_COORDINATE_MOVES.epMoves[moveIndex][epRank],
          PHASE2_COORDINATE_MOVES.sliceMoves[moveIndex][sliceRank],
          bound - 1,
          path,
          spec.face,
        );
        path.pop();
        if (result) return result;
      }
      return null;
    }

    solvePhase2(state, lastFace, maximum = 18) {
      const cpRank = permutationRank(state.cp);
      const epRank = permutationRank(state.ep.slice(0, 8));
      const sliceRank = permutationRank(slicePermutation(state.ep));
      for (let bound = this.phase2HeuristicCoords(cpRank, epRank, sliceRank); bound <= maximum; bound += 1) {
        const result = this.phase2Search(cpRank, epRank, sliceRank, bound, [], lastFace);
        if (result) return result;
      }
      return null;
    }

    stateFromPath(initial, path) {
      const state = {
        cp: initial.cp.slice(),
        co: initial.co.slice(),
        ep: initial.ep.slice(),
        eo: initial.eo.slice(),
      };
      for (const token of path) {
        applyTokenToState(state, TOKEN_SPECS.find((spec) => spec.token === token));
      }
      return state;
    }

    collectPhase1Goals(initial, coRank, eoRank, mask, bound, path, lastFace, goals) {
      const heuristic = this.phase1HeuristicCoords(coRank, eoRank, mask);
      if (heuristic > bound) return;
      if (bound === 0) {
        if (coRank !== 0 || eoRank !== 0 || mask !== SOLVED_MASK) return;
        const state = this.stateFromPath(initial, path);
        goals.push({
          state,
          path: path.slice(),
          lastFace,
          phase2Heuristic: this.phase2Heuristic(state),
        });
        return;
      }
      for (let moveIndex = 0; moveIndex < TOKEN_SPECS.length; moveIndex += 1) {
        const spec = TOKEN_SPECS[moveIndex];
        if (redundantPair(lastFace, spec.face)) continue;
        path.push(spec.token);
        const nextMask = COORDINATE_MOVES.maskMoves[moveIndex][mask];
        this.collectPhase1Goals(
          initial,
          COORDINATE_MOVES.coMoves[moveIndex][coRank],
          COORDINATE_MOVES.eoPerms[moveIndex][eoRank] ^ COORDINATE_MOVES.flipRanks[moveIndex][mask],
          nextMask,
          bound - 1,
          path,
          spec.face,
          goals,
        );
        path.pop();
      }
    }

    phase1Search(state, bound, path, lastFace, maxPhase2) {
      const goals = [];
      this.collectPhase1Goals(
        state,
        encodeCO(state.co),
        encodeEO(state.eo),
        sliceMaskFromEP(state.ep),
        bound,
        path,
        lastFace,
        goals,
      );
      goals.sort((a, b) => a.phase2Heuristic - b.phase2Heuristic || a.path.length - b.path.length);
      const limit = Math.min(goals.length, 160);
      for (let i = 0; i < limit; i += 1) {
        const goal = goals[i];
        const phase2 = this.solvePhase2(goal.state, goal.lastFace, maxPhase2);
        if (phase2) return goal.path.concat(phase2);
      }
      return null;
    }

    solveState(cube) {
      if (!this.ready) throw new Error("求解表尚未就绪。");
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      const frameMoves = frameRotationMoves(cube);
      const normalized = cube.clone();
      for (const token of frameMoves) normalized.applyMove(parseMove(token));
      const initial = snapshotCubieState(normalized);
      let solution = null;
      const startBound = this.phase1Heuristic(initial);
      for (let bound = Math.max(1, startBound); bound <= 13 && !solution; bound += 1) {
        solution = this.phase1Search(initial, bound, [], "", 18);
      }
      if (!solution) throw new Error("未找到完整解法。");
      const tokens = frameMoves.concat(solution);
      const verification = cube.clone();
      for (const token of tokens) verification.applyMove(parseMove(token));
      if (!verification.isSolved()) throw new Error("求解计划未通过完整魔方校验。");
      return {
        tokens,
        frameMoves,
        milliseconds: (typeof performance !== "undefined" ? performance.now() : Date.now()) - start,
      };
    }

    makePlan(cube, method = "CFOP") {
      const result = this.solveState(cube);
      return this.makePlanFromTokens(
        cube,
        method,
        result.tokens,
        result.frameMoves,
        result.milliseconds,
      );
    }

    makePlanFromTokens(cube, method = "CFOP", tokens = [], frameMoves = [], milliseconds = 0) {
      const verification = cube.clone();
      for (const token of tokens) verification.applyMove(parseMove(token));
      if (!verification.isSolved()) throw new Error("求解计划未通过完整魔方校验。");
      const stageMeta = Algs.METHODS[method] || Algs.METHODS.CFOP;
      const stageCount = stageMeta.stages.length;
      const total = tokens.length;
      if (total === 0) {
        return {
          method,
          methodMeta: stageMeta,
          steps: [],
          tokens: [],
          frameMoves,
          stages: stageMeta.stages.map((stage) => ({ ...stage, count: 0 })),
          solveMilliseconds: milliseconds,
        };
      }
      const raw = stageCount === 4 ? [0.18, 0.47, 0.2, 0.15] : new Array(stageCount).fill(1 / stageCount);
      const counts = new Array(stageCount).fill(0);
      if (total < stageCount) {
        for (let i = 0; i < total; i += 1) counts[i] = 1;
      } else {
        for (let i = 0; i < stageCount; i += 1) counts[i] = Math.max(1, Math.floor(total * raw[i]));
      }
      let sum = counts.reduce((a, b) => a + b, 0);
      while (sum > total) {
        const order = counts
          .map((count, index) => ({ count, index }))
          .filter((item) => item.count > 1)
          .sort((a, b) => b.count - a.count);
        if (!order.length) break;
        counts[order[0].index] -= 1;
        sum -= 1;
      }
      while (sum < total) {
        counts[counts.length - 1] += 1;
        sum += 1;
      }
      const steps = [];
      let offset = 0;
      for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
        const stage = stageMeta.stages[stageIndex];
        for (let i = 0; i < counts[stageIndex]; i += 1) {
          const token = tokens[offset + i];
          const move = parseMove(token);
          let description = move.label;
          if (description.length > 24) description = description.slice(0, 24);
          steps.push({
            index: steps.length,
            token,
            description,
            stageIndex,
            stageName: stage.name,
            color: stage.color,
          });
        }
        offset += counts[stageIndex];
      }
      return {
        method,
        methodMeta: stageMeta,
        steps,
        tokens,
        frameMoves,
        stages: stageMeta.stages.map((stage, index) => ({
          ...stage,
          count: counts[index],
        })),
        solveMilliseconds: milliseconds,
      };
    }
  }

  let sharedSolver = null;

  function getSolver() {
    if (!sharedSolver) sharedSolver = new TwoPhaseSolver();
    return sharedSolver;
  }

  return {
    TwoPhaseSolver,
    getSolver,
    frameRotationMoves,
    snapshotCubieState,
    applyTokenToState,
    encodeCO,
    encodeEO,
    permutationRank,
    permutationUnrank,
    MECHANICS,
    TOKEN_SPECS,
    PHASE2_TOKENS,
    SLICE_MASKS,
    SLICE_RANKS,
    COORDINATE_MOVES,
    PHASE2_COORDINATE_MOVES,
  };
});
