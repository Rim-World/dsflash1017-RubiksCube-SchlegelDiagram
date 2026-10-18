"use strict";

const assert = require("node:assert/strict");
const {
  Cube,
  scrambleCube,
  parseMove,
} = require("../src/cube.js");
const { TwoPhaseSolver } = require("../src/solver.js");

function makeRng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1103515245 + 12345) >>> 0;
    return value / 4294967296;
  };
}

function verifyPlan(cube, plan) {
  const check = cube.clone();
  for (const step of plan.steps) check.applyMove(parseMove(step.token));
  assert.equal(check.isSolved(), true, "计划执行后没有还原完整魔方");
  const stageSum = plan.stages.reduce((sum, stage) => sum + stage.count, 0);
  assert.equal(stageSum, plan.steps.length, "阶段步数合计不等于总步数");
}

async function directRegression(solver) {
  const states = [
    "R",
    "R U",
    "R U R' U'",
    "F R U R' U' F'",
    "R U R' U' R' F R2 U' R' U' R U R' F'",
    "M R",
  ];
  for (const text of states) {
    const cube = Cube.solved();
    for (const token of text.split(/\s+/)) cube.applyMove(parseMove(token));
    const plan = solver.makePlan(cube, "CFOP");
    verifyPlan(cube, plan);
    assert.ok(plan.steps.length <= 80);
    if (!cube.centersAligned()) {
      assert.ok(plan.frameMoves.length > 0, "中心未摆正时计划遗漏整体转动");
      assert.equal(plan.steps[0].token, plan.frameMoves[0], "计划第一步没有摆正中心");
    }
  }
}

async function main() {
  const rounds = Math.max(1, Number(process.env.ROUNDS) || 150);
  const rng = makeRng(0xc0ffee);
  const solver = new TwoPhaseSolver();
  await solver.prepare();
  const averages = { CFOP: [], ROUX: [] };
  const solveTimes = [];
  let failures = 0;

  for (let round = 0; round < rounds; round += 1) {
    const scramble = scrambleCube(24, rng);
    for (const method of ["CFOP", "ROUX"]) {
      try {
        const started = Date.now();
        const plan = solver.makePlan(scramble.cube, method);
        solveTimes.push(Date.now() - started);
        verifyPlan(scramble.cube, plan);
        assert.equal(plan.stages.length, 4);
        assert.equal(
          plan.steps.length,
          plan.stages.reduce((sum, stage) => sum + stage.count, 0),
        );
        const limit = method === "CFOP" ? 80 : 65;
        assert.ok(plan.steps.length <= limit, `${method} 平均步数超出目标`);
        averages[method].push(plan.steps.length);
      } catch (error) {
        failures += 1;
        process.stderr.write(`第 ${round + 1} 轮 ${method} 失败：${error.message}\n`);
      }
    }
  }

  assert.equal(failures, 0, `求解回归存在 ${failures} 次失败`);
  const cfopAverage = averages.CFOP.reduce((sum, value) => sum + value, 0) / averages.CFOP.length;
  const rouxAverage = averages.ROUX.reduce((sum, value) => sum + value, 0) / averages.ROUX.length;
  assert.ok(cfopAverage <= 80);
  assert.ok(rouxAverage <= 65);
  const maximumSolveTime = Math.max(...solveTimes);
  assert.ok(maximumSolveTime < 1000, `单次求解耗时超过 1 s：${maximumSolveTime} ms`);
  await directRegression(solver);
  process.stdout.write(
    `test-solver: ${rounds * 2} 次回归通过，CFOP 平均 ${cfopAverage.toFixed(2)} 步，桥式平均 ${rouxAverage.toFixed(2)} 步，最长 ${maximumSolveTime} ms。\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
