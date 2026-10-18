"use strict";

const assert = require("node:assert/strict");
const {
  Cube,
  ALL_MOVES,
  parseMove,
  parseSequence,
  inverseMove,
  FACE_COLORS,
  FACE_ORDER,
} = require("../src/cube.js");

function makeRng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function assertStickerGeometry(cube) {
  let stickerCount = 0;
  const slots = new Set();
  for (const cubie of cube.cubies) {
    const expected = cubie.kind === "corner" ? 3 : cubie.kind === "edge" ? 2 : 1;
    assert.equal(cubie.stickers.length, expected, `${cubie.id} 的贴纸数量错误`);
    for (const sticker of cubie.stickers) {
      stickerCount += 1;
      const normal = [
        cubie.orientation[0] * sticker.local[0] +
          cubie.orientation[1] * sticker.local[1] +
          cubie.orientation[2] * sticker.local[2],
        cubie.orientation[3] * sticker.local[0] +
          cubie.orientation[4] * sticker.local[1] +
          cubie.orientation[5] * sticker.local[2],
        cubie.orientation[6] * sticker.local[0] +
          cubie.orientation[7] * sticker.local[1] +
          cubie.orientation[8] * sticker.local[2],
      ];
      const outwardDot =
        normal[0] * cubie.position[0] +
        normal[1] * cubie.position[1] +
        normal[2] * cubie.position[2];
      assert.ok(outwardDot >= 0.99, `${cubie.id} 的贴纸法线没有朝向外面`);
      slots.add(sticker.id);
    }
  }
  assert.equal(stickerCount, 54);
  assert.equal(slots.size, 54);
  assert.equal(Object.keys(cube.stickerTable()).length, 54);
}

function main() {
  const solved = Cube.solved();
  assert.equal(solved.cubies.length, 26);
  assert.equal(solved.cubies.filter((cubie) => cubie.kind === "corner").length, 8);
  assert.equal(solved.cubies.filter((cubie) => cubie.kind === "edge").length, 12);
  assert.equal(solved.cubies.filter((cubie) => cubie.kind === "center").length, 6);
  assert.equal(solved.isSolved(), true);
  assert.equal(solved.centersAligned(), true);
  assertStickerGeometry(solved);

  const table = solved.stickerTable();
  assert.deepEqual(
    Object.keys(table).sort(),
    "URFDLB".split("").flatMap((face) =>
      [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => `${face}${row}${col}`)),
    ).sort(),
  );
  for (const face of FACE_ORDER) {
    const entries = Object.values(table).filter((entry) => entry.face === face);
    assert.equal(entries.length, 9);
    assert.ok(entries.every((entry) => entry.color === FACE_COLORS[face]));
  }

  for (const move of ALL_MOVES) {
    const cube = Cube.solved().applyMove(move);
    assert.equal(cube.isSolved(), false, `${move.name} 没有改变还原魔方`);
    assertStickerGeometry(cube);
    cube.applyMove(inverseMove(move));
    assert.equal(cube.isSolved(), true, `${move.name} 的逆转动没有还原`);
  }

  const rng = makeRng(0x51c0ffee);
  const randomMoves = [];
  for (let index = 0; index < 400; index += 1) {
    const move = ALL_MOVES[Math.floor(rng() * ALL_MOVES.length)];
    randomMoves.push(move);
  }
  const walked = Cube.solved();
  for (const move of randomMoves) {
    walked.applyMove(move);
    assertStickerGeometry(walked);
  }
  for (let index = randomMoves.length - 1; index >= 0; index -= 1) {
    walked.applyMove(inverseMove(randomMoves[index]));
  }
  assert.equal(walked.isSolved(), true, "400 步随机走位没有按逆序回代");

  const randomState = Cube.solved().applyMoves(
    parseSequence("R U R' U' F2 M E S Rw' U2 B L2 D' x y' z2"),
  );
  const beforeCopy = JSON.stringify(randomState.cubies.map((cubie) => ({
    position: cubie.position,
    orientation: cubie.orientation,
  })));
  const copy = randomState.clone();
  copy.applyMove(parseMove("U"));
  const afterCopy = JSON.stringify(randomState.cubies.map((cubie) => ({
    position: cubie.position,
    orientation: cubie.orientation,
  })));
  assert.equal(afterCopy, beforeCopy, "状态副本修改了原状态");

  process.stdout.write("test-cube: 26 小块、54 贴纸、54 种转动和 400 步回代检查通过。\n");
}

main();
