(function () {
  "use strict";

  const {
    Cube,
    FACE_COLORS,
    FACE_NAMES,
    parseMove,
    parseSequence,
    inverseMove,
    randomScramble,
    scrambleCube,
  } = window.CubeLab.CubeData;
  const Graph = window.CubeLab.Graph;
  const Renderer = window.CubeLab.Renderer;
  const Solver = window.CubeLab.Solver;
  const Algs = window.CubeLab.Algs;
  const GL = window.CubeLab.GLUtil;

  const byId = (id) => document.getElementById(id);
  const elements = {
    cubeCanvas: byId("cubeCanvas"),
    graphCanvas: byId("graphCanvas"),
    meshStage: byId("meshStage"),
    graphStage: document.querySelector(".graph-stage"),
    webglFallback: byId("webglFallback"),
    headerStatus: byId("headerStatus"),
    statusLamp: byId("statusLamp"),
    solvedSeal: byId("solvedSeal"),
    turnReadout: byId("turnReadout"),
    graphTurnNote: byId("graphTurnNote"),
    scrambleButton: byId("scrambleButton"),
    resetButton: byId("resetButton"),
    resetView: byId("resetView"),
    methodButtons: Array.from(document.querySelectorAll(".method-button")),
    methodSubtitle: byId("methodSubtitle"),
    solveButton: byId("solveButton"),
    stageCards: byId("stageCards"),
    stageChip: byId("stageChip"),
    stageNote: byId("stageNote"),
    pauseBadge: byId("pauseBadge"),
    stepList: byId("stepList"),
    stepCounter: byId("stepCounter"),
    progressStage: byId("progressStage"),
    stageRuler: byId("stageRuler"),
    playProgress: byId("playProgress"),
    prevButton: byId("prevButton"),
    playButton: byId("playButton"),
    pauseButton: byId("pauseButton"),
    nextButton: byId("nextButton"),
    speedSlider: byId("speedSlider"),
    speedValue: byId("speedValue"),
    solverReady: byId("solverReady"),
    liveAnnouncer: byId("liveAnnouncer"),
  };

  const STAGE_NOTES = {
    十字: "四枚底层棱块",
    F2L: "嵌入角块与棱块",
    OLL: "统一顶层朝向",
    PLL: "完成顶层定位",
    FB: "完成左侧方块",
    SB: "完成右侧方块",
    CMLL: "解决顶层四角",
    LSE: "调整六枚棱块",
  };

  const state = {
    cube: Cube.solved(),
    method: "CFOP",
    plan: null,
    cursor: 0,
    playing: false,
    paused: false,
    speed: 1,
    active: null,
    drag: null,
    history: [],
    solved: true,
    lastFrame: performance.now(),
    framePending: false,
    previewTurn: null,
    stepRows: [],
    currentStage: 0,
    pendingTimeout: null,
    pendingSolve: false,
    cameraFrame: null,
    lastCameraTime: 0,
    activeStageAnnouncement: "",
  };

  const solver = Solver.getSolver();
  let renderer = null;
  let graphView = null;
  let disposeDprWatch = null;
  let resizeQueued = false;

  try {
    renderer = new Renderer.CubeRenderer(elements.cubeCanvas);
  } catch (error) {
    elements.webglFallback.hidden = false;
    elements.webglFallback.querySelector("b").textContent = "三维画布不可用";
    elements.webglFallback.querySelector("span").textContent =
      `${error.message} 图论与求解功能仍可查看。`;
  }

  if (elements.graphCanvas) {
    try {
      graphView = new Graph.GraphView(elements.graphCanvas);
    } catch (error) {
      graphView = null;
    }
  }

  function cloneLayers(layers) {
    return layers.slice().sort((a, b) => a - b);
  }

  function sameLayers(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const left = cloneLayers(a);
    const right = cloneLayers(b);
    return left.every((value, index) => value === right[index]);
  }

  function normalizeQuarter(angle) {
    let result = ((angle % 4) + 4) % 4;
    if (result === 3) result = -1;
    return result;
  }

  function faceBaseFor(axis, layer) {
    if (axis === "x") return layer === 1 ? "R" : "L";
    if (axis === "y") return layer === 1 ? "U" : "D";
    return layer === 1 ? "F" : "B";
  }

  function baseMoveForLayers(axis, layers, angle) {
    const sorted = cloneLayers(layers);
    if (sorted.length === 3) {
      return {
        base: axis,
        baseAngle: 1,
        wide: false,
        slice: false,
      };
    }
    if (sorted.length === 1 && sorted[0] === 0) {
      return {
        base: axis === "x" ? "M" : axis === "y" ? "E" : "S",
        baseAngle: axis === "z" ? 1 : -1,
        wide: false,
        slice: true,
      };
    }
    if (sorted.length === 1) {
      const face = faceBaseFor(axis, sorted[0]);
      return {
        base: face,
        baseAngle: face === "D" || face === "L" || face === "B" ? -1 : 1,
        wide: false,
        slice: false,
      };
    }
    if (sorted.length === 2 && sorted.includes(0)) {
      const outer = sorted.find((layer) => layer !== 0);
      if (Math.abs(outer) === 1) {
        const face = faceBaseFor(axis, outer);
        return {
          base: face,
          baseAngle: face === "D" || face === "L" || face === "B" ? -1 : 1,
          wide: true,
          slice: false,
        };
      }
    }
    return {
      base: axis,
      baseAngle: 1,
      wide: false,
      slice: false,
    };
  }

  function moveTokenForLayers(axis, layers, angle) {
    const normalized = normalizeQuarter(angle);
    if (normalized === 0) return "";
    const info = baseMoveForLayers(axis, layers, normalized);
    let suffix = "";
    if (normalized === 2 || normalized === -2) suffix = "2";
    else if (normalized * info.baseAngle < 0) suffix = "'";
    return `${info.base}${info.wide ? "w" : ""}${suffix}`;
  }

  function moveForLayers(axis, layers, angle) {
    const normalized = normalizeQuarter(angle);
    if (normalized === 0) {
      return {
        axis,
        layers: cloneLayers(layers),
        angle: 0,
        name: "",
        label: "回弹",
      };
    }
    const token = moveTokenForLayers(axis, layers, normalized);
    const parsed = parseMove(token);
    parsed.layers = cloneLayers(layers);
    parsed.angle = normalized;
    parsed.name = token;
    parsed.notation = token;
    parsed.label = window.CubeLab.CubeData.describeTurn(parsed);
    return parsed;
  }

  function inverseToken(move) {
    const normalized = Math.abs(move.angle);
    if (normalized === 2) return moveTokenForLayers(move.axis, move.layers, 2);
    if (move.angle > 0) {
      const opposite = moveTokenForLayers(move.axis, move.layers, -1);
      return opposite;
    }
    return moveTokenForLayers(move.axis, move.layers, 1);
  }

  function simplifyHistory(history) {
    const result = [];
    for (const original of history) {
      if (!original || !original.angle) continue;
      const move = {
        axis: original.axis,
        layers: cloneLayers(original.layers),
        angle: normalizeQuarter(original.angle),
      };
      if (!move.angle) continue;
      const previous = result[result.length - 1];
      if (previous && previous.axis === move.axis && sameLayers(previous.layers, move.layers)) {
        const combined = normalizeQuarter(previous.angle + move.angle);
        if (combined === 0) result.pop();
        else previous.angle = combined;
      } else {
        result.push(move);
      }
    }
    return result;
  }

  function historySolutionTokens() {
    const reduced = simplifyHistory(state.history);
    return reduced.reverse().map((move) =>
      moveTokenForLayers(move.axis, move.layers, -move.angle));
  }

  function recordMove(move) {
    if (!move || !move.angle) return;
    state.history.push({
      axis: move.axis,
      layers: move.layers.slice(),
      angle: normalizeQuarter(move.angle),
    });
    if (state.history.length > 240) {
      state.history = simplifyHistory(state.history).slice(-160);
    }
  }

  function currentStageDefinition() {
    return Algs.METHODS[state.method].stages[state.currentStage] || Algs.METHODS[state.method].stages[0];
  }

  function currentStageIndex() {
    if (!state.plan || !state.plan.steps.length) return 0;
    if (state.cursor >= state.plan.steps.length) return state.plan.stages.length - 1;
    return state.plan.steps[state.cursor].stageIndex;
  }

  function largestRemainderPercentages(counts, total) {
    if (!total) return counts.map(() => 0);
    const raw = counts.map((count) => count / total * 100);
    const floors = raw.map(Math.floor);
    let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);
    const order = raw
      .map((value, index) => ({ index, remainder: value - floors[index] }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i += 1) floors[order[i % order.length].index] += 1;
    return floors;
  }

  function renderStageCards() {
    const method = Algs.METHODS[state.method];
    const counts = state.plan ? state.plan.stages.map((stage) => stage.count) : [0, 0, 0, 0];
    const total = state.plan ? state.plan.steps.length : 0;
    const percentages = largestRemainderPercentages(counts, total);
    elements.stageCards.innerHTML = "";
    method.stages.forEach((stage, index) => {
      const card = document.createElement("article");
      card.className = "stage-card";
      card.style.setProperty("--stage-color", stage.color);
      if (index === state.currentStage) card.classList.add("is-current");
      const name = document.createElement("b");
      name.textContent = stage.name;
      const steps = document.createElement("span");
      steps.className = "stage-steps";
      steps.textContent = `${counts[index]} 步`;
      const percentage = document.createElement("span");
      percentage.className = "stage-percent";
      percentage.textContent = total ? `${percentages[index]}%` : "待计算";
      card.append(name, steps, percentage);
      elements.stageCards.append(card);
    });
  }

  function renderRuler() {
    const method = Algs.METHODS[state.method];
    elements.stageRuler.innerHTML = "";
    const counts = state.plan ? state.plan.stages.map((stage) => stage.count) : [1, 1, 1, 1];
    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, index) => {
      const segment = document.createElement("span");
      segment.style.width = `${count / total * 100}%`;
      segment.style.setProperty("--stage-color", method.stages[index].color);
      elements.stageRuler.append(segment);
    });
  }

  function buildStepList() {
    elements.stepList.innerHTML = "";
    state.stepRows = [];
    if (!state.plan || !state.plan.steps.length) {
      const empty = document.createElement("li");
      empty.className = "step-empty";
      const title = document.createElement("b");
      title.textContent = "尚未生成求解计划";
      const note = document.createElement("span");
      note.textContent = "打乱或手动转动后，点击「求解当前状态」。";
      empty.append(title, note);
      elements.stepList.append(empty);
      return;
    }
    const groups = new Map();
    for (const step of state.plan.steps) {
      if (!groups.has(step.stageIndex)) groups.set(step.stageIndex, []);
      groups.get(step.stageIndex).push(step);
    }
    for (const [stageIndex, steps] of groups) {
      const stageMeta = state.plan.stages[stageIndex];
      const group = document.createElement("li");
      group.className = "stage-group";
      const title = document.createElement("div");
      title.className = "stage-group-title";
      title.style.setProperty("--stage-color", stageMeta.color);
      const marker = document.createElement("i");
      marker.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = stageMeta.name;
      title.append(marker, label);
      group.append(title);
      for (const step of steps) {
        const row = document.createElement("div");
        row.className = "step-row";
        row.setAttribute("role", "listitem");
        row.dataset.index = String(step.index);
        row.style.setProperty("--step-color", step.color);
        row.setAttribute("aria-label", `第 ${step.index + 1} 步，${step.token}，${step.description}`);
        const token = document.createElement("span");
        token.className = "step-token";
        token.textContent = step.token;
        const description = document.createElement("span");
        description.className = "step-description";
        description.textContent = step.description;
        const check = document.createElement("span");
        check.className = "step-check";
        check.textContent = "✓";
        check.setAttribute("aria-hidden", "true");
        row.append(token, description, check);
        group.append(row);
        state.stepRows.push(row);
      }
      elements.stepList.append(group);
    }
  }

  function scrollCurrentStepIntoView() {
    if (!state.plan || !state.stepRows.length) return;
    const index = Math.min(state.cursor, state.plan.steps.length - 1);
    const row = state.stepRows[index];
    if (!row) return;
    const list = elements.stepList;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      list.scrollTop -= listRect.top - rowRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      list.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }

  function updateStepHighlight(shouldScroll = false) {
    const total = state.plan ? state.plan.steps.length : 0;
    state.stepRows.forEach((row, index) => {
      const complete = index < state.cursor;
      const current = index === state.cursor && state.cursor < total;
      row.classList.toggle("is-complete", complete);
      row.classList.toggle("is-current", current);
      if (current) row.setAttribute("aria-current", "step");
      else row.removeAttribute("aria-current");
    });
    if (shouldScroll) scrollCurrentStepIntoView();
  }

  function updateStatus() {
    const solved = state.cube.isSolved();
    state.solved = solved;
    elements.solvedSeal.classList.toggle("is-hidden", !solved);
    elements.statusLamp.classList.toggle("is-scrambled", !solved);
    let label = solved ? "已还原" : "待求解";
    if (state.playing) label = "播放中";
    else if (state.paused && state.plan && state.cursor < state.plan.steps.length) label = "已暂停";
    elements.headerStatus.textContent = label;
    elements.pauseBadge.hidden = !(state.paused && state.plan && state.cursor < state.plan.steps.length);
    elements.pauseBadge.textContent = "已暂停";
    const stageDef = currentStageDefinition();
    elements.stageChip.textContent = stageDef.name;
    elements.stageChip.style.setProperty("--stage-color", stageDef.color);
    elements.progressStage.textContent = stageDef.name;
    elements.progressStage.style.setProperty("--stage-color", stageDef.color);
    elements.stageNote.textContent = STAGE_NOTES[stageDef.name] || "按阶段执行求解步骤";
    const stageChanged = state.currentStage !== currentStageIndex();
    state.currentStage = currentStageIndex();
    if (stageChanged) {
      announce(`当前阶段：${currentStageDefinition().name}`);
    }
    const total = state.plan ? state.plan.steps.length : 0;
    const displayStep = total ? (state.cursor < total ? state.cursor + 1 : total) : 0;
    elements.stepCounter.textContent = `${displayStep} / ${total}`;
    const completed = total ? Math.min(state.cursor, total) : 0;
    elements.playProgress.style.width = total ? `${completed / total * 100}%` : "0%";
    elements.prevButton.disabled = !state.plan || state.cursor <= 0 || !!state.active;
    elements.nextButton.disabled = !state.plan || state.cursor >= total || !!state.active;
    elements.playButton.disabled = !state.plan || !total || state.cursor >= total || !!state.active;
    elements.pauseButton.disabled = !state.plan || state.cursor >= total || (!state.playing && !state.paused);
    elements.playButton.setAttribute("aria-label", state.paused ? "继续播放" : "播放");
    elements.pauseButton.setAttribute("aria-label", "暂停");
    const cubeAria = solved ? "已还原" : "尚未还原";
    elements.cubeCanvas.setAttribute(
      "aria-label",
      `三阶魔方立体图，${cubeAria}，当前视角与图论视图同步`,
    );
    elements.graphCanvas.setAttribute(
      "aria-label",
      `三阶魔方的九环平面嵌入图，54 个贴纸节点和 108 条圆弧，${cubeAria}`,
    );
  }

  function refreshPlanUI({ rebuild = false, scroll = false } = {}) {
    state.currentStage = currentStageIndex();
    if (rebuild) {
      buildStepList();
      renderStageCards();
      renderRuler();
    } else {
      renderStageCards();
    }
    updateStepHighlight(scroll);
    updateStatus();
  }

  function announce(message) {
    if (!message) return;
    elements.liveAnnouncer.textContent = "";
    window.setTimeout(() => {
      elements.liveAnnouncer.textContent = message;
    }, 20);
  }

  function clearPlan() {
    clearPendingTimeout();
    state.plan = null;
    state.cursor = 0;
    state.playing = false;
    state.paused = false;
    state.currentStage = 0;
    refreshPlanUI({ rebuild: true });
  }

  function setMethod(method) {
    if (!Algs.METHODS[method] || method === state.method) return;
    state.method = method;
    elements.methodButtons.forEach((button) => {
      const active = button.dataset.method === method;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    elements.methodSubtitle.textContent = method === "ROUX"
      ? "ROUX / BLOCKS"
      : "CROSS / F2L / OLL / PLL";
    clearPlan();
    scheduleDraw();
  }

  function computeGraphViewForTurn(baseCube, move, quarterAngle) {
    if (!move || Math.abs(quarterAngle) < 1e-7) {
      return { cube: baseCube, animation: null };
    }
    const sign = Math.sign(quarterAngle);
    const magnitude = Math.abs(quarterAngle);
    const whole = Math.floor(magnitude + 1e-7);
    const fraction = magnitude - whole;
    let startCube = baseCube;
    if (whole > 0) {
      startCube = baseCube.clone();
      startCube.rotateLayer(move.axis, move.layers, sign * whole);
    }
    if (fraction < 1e-6) {
      return { cube: startCube, animation: null };
    }
    const endCube = startCube.clone();
    endCube.rotateLayer(move.axis, move.layers, sign);
    const key = `${move.axis}:${move.layers.join(",")}:${sign * whole}`;
    if (!state.graphSegmentCache || state.graphSegmentCache.key !== key) {
      state.graphSegmentCache = {
        key,
        startCube,
        endCube,
        paths: Graph.movementPaths(startCube, endCube),
      };
    }
    const cache = state.graphSegmentCache;
    return {
      cube: cache.startCube,
      animation: {
        startCube: cache.startCube,
        endCube: cache.endCube,
        progress: fraction,
        paths: cache.paths,
      },
    };
  }

  function getPreview() {
    let move = null;
    let q = 0;
    if (state.active) {
      move = state.active.move;
      q = state.active.q;
    } else if (state.drag && state.drag.kind === "turn" && state.drag.move) {
      move = state.drag.move;
      q = state.drag.q;
    }
    if (!move || Math.abs(q) < 1e-7) {
      return {
        base: state.cube,
        turn: null,
        graphCube: state.cube,
        graphAnimation: null,
        move: null,
      };
    }
    const graph = computeGraphViewForTurn(state.cube, move, q);
    return {
      base: state.cube,
      turn: {
        axis: move.axis,
        layers: move.layers,
        angleRadians: q * Math.PI / 2,
      },
      graphCube: graph.cube,
      graphAnimation: graph.animation,
      move,
    };
  }

  function drawFrame() {
    state.framePending = false;
    const preview = getPreview();
    state.previewTurn = preview.turn;
    if (renderer) renderer.draw(preview.base, preview.turn);
    if (graphView) {
      graphView.setHighlight(preview.move || (state.plan && state.cursor < state.plan.steps.length
        ? parseMove(state.plan.steps[state.cursor].token)
        : null));
      graphView.draw(preview.graphCube, { animation: preview.graphAnimation });
    }
    updateTurnReadout(preview.move);
  }

  function scheduleDraw() {
    if (state.framePending) return;
    state.framePending = true;
    requestAnimationFrame(drawFrame);
  }

  function updateTurnReadout(move) {
    const visible = !!move && (!state.drag || state.drag.kind === "turn" || !!state.active);
    elements.turnReadout.textContent = visible ? move.label || "" : "";
    elements.graphTurnNote.textContent = visible ? move.label || "" : "";
    elements.turnReadout.classList.toggle("is-visible", visible);
    elements.graphTurnNote.classList.toggle("is-visible", visible);
  }

  function clearPendingTimeout() {
    if (state.pendingTimeout !== null) {
      clearTimeout(state.pendingTimeout);
      state.pendingTimeout = null;
    }
  }

  function durationForMove(move, fromQ = 0) {
    const remaining = Math.abs(move.angle - fromQ);
    const perQuarter = Math.abs(move.angle) >= 2 ? 0.215 : 0.3;
    return Math.max(0.08, remaining * perQuarter);
  }

  function startActiveMove(move, fromQ, toQ, options = {}) {
    clearPendingTimeout();
    state.active = {
      move,
      fromQ,
      toQ,
      q: fromQ,
      baseDuration: options.duration || durationForMove(move, fromQ) * (options.speedFactor || 1),
      progress: 0,
      stepIndex: options.stepIndex === undefined ? null : options.stepIndex,
      commit: options.commit !== false,
      manual: !!options.manual,
    };
    state.graphSegmentCache = null;
    state.lastFrame = performance.now();
    updateStatus();
    scheduleDraw();
    requestAnimationFrame(tickAnimation);
  }

  function finishActiveImmediately() {
    if (!state.active) return;
    const active = state.active;
    state.cube.rotateLayer(active.move.axis, active.move.layers, active.toQ);
    if (active.toQ && active.commit) recordMove({
      axis: active.move.axis,
      layers: active.move.layers,
      angle: active.toQ,
    });
    if (active.stepIndex !== null) state.cursor = Math.max(state.cursor, active.stepIndex + 1);
    state.active = null;
    state.graphSegmentCache = null;
    const solvedNow = state.cube.isSolved();
    if (solvedNow && state.plan && state.cursor >= state.plan.steps.length) {
      state.playing = false;
      state.paused = false;
      announce("已完成还原");
    }
    refreshPlanUI({ scroll: true });
    scheduleDraw();
  }

  function cancelActive() {
    clearPendingTimeout();
    state.active = null;
    state.graphSegmentCache = null;
    state.playing = false;
    state.paused = false;
    refreshPlanUI();
    scheduleDraw();
  }

  function commitActive() {
    if (!state.active) return;
    const active = state.active;
    if (active.toQ !== 0) {
      state.cube.rotateLayer(active.move.axis, active.move.layers, active.toQ);
      if (active.commit) {
        recordMove({
          axis: active.move.axis,
          layers: active.move.layers,
          angle: active.toQ,
        });
      }
    }
    if (active.stepIndex !== null) state.cursor = active.stepIndex + 1;
    const wasManual = active.manual;
    const completedPlan = state.plan && state.cursor >= state.plan.steps.length;
    state.active = null;
    state.graphSegmentCache = null;
    if (wasManual && active.commit && state.plan) {
      state.plan = null;
      state.cursor = 0;
      state.playing = false;
      state.paused = false;
      buildStepList();
      renderRuler();
    }
    if (completedPlan && state.cube.isSolved()) {
      state.playing = false;
      state.paused = false;
      announce("已完成还原");
    }
    refreshPlanUI({ scroll: true });
    scheduleDraw();
    if (state.playing && state.plan && state.cursor < state.plan.steps.length) {
      state.pendingTimeout = window.setTimeout(() => {
        state.pendingTimeout = null;
        playNextAnimated();
      }, 200);
    }
  }

  function tickAnimation(timestamp) {
    if (!state.active) return;
    const active = state.active;
    const dt = Math.min(0.05, Math.max(0, (timestamp - state.lastFrame) / 1000));
    state.lastFrame = timestamp;
    active.progress = Math.min(1, active.progress + dt * state.speed / active.baseDuration);
    const normalized = active.progress;
    const eased = GL.easeInOutCubic(normalized);
    active.q = active.fromQ + (active.toQ - active.fromQ) * eased;
    scheduleDraw();
    if (normalized >= 1) {
      active.q = active.toQ;
      drawFrame();
      commitActive();
      return;
    }
    requestAnimationFrame(tickAnimation);
  }

  function playNextAnimated() {
    if (!state.plan || state.active || state.cursor >= state.plan.steps.length) return;
    const step = state.plan.steps[state.cursor];
    const move = parseMove(step.token);
    state.playing = true;
    state.paused = false;
    startActiveMove(move, 0, move.angle, {
      stepIndex: state.cursor,
      commit: true,
    });
  }

  function play() {
    if (!state.plan || state.cursor >= state.plan.steps.length) return;
    state.playing = true;
    state.paused = false;
    if (!state.active) playNextAnimated();
    updateStatus();
  }

  function pause() {
    if (!state.plan || state.cursor >= state.plan.steps.length) return;
    state.playing = false;
    state.paused = true;
    clearPendingTimeout();
    updateStatus();
    announce("已暂停");
  }

  function togglePlayback() {
    if (state.playing) pause();
    else play();
  }

  function directApplyPlanStep(index) {
    const step = state.plan.steps[index];
    const move = parseMove(step.token);
    state.cube.applyMove(move);
    recordMove(move);
  }

  function directUndoPlanStep(index) {
    const step = state.plan.steps[index];
    const move = inverseMove(parseMove(step.token));
    state.cube.applyMove(move);
    recordMove(move);
  }

  function nextStep() {
    if (!state.plan || state.active || state.cursor >= state.plan.steps.length) return;
    state.playing = false;
    state.paused = true;
    directApplyPlanStep(state.cursor);
    state.cursor += 1;
    if (state.cursor >= state.plan.steps.length) {
      state.paused = false;
      announce("已完成还原");
    }
    refreshPlanUI({ scroll: true });
    scheduleDraw();
  }

  function previousStep() {
    if (!state.plan || state.active || state.cursor <= 0) return;
    state.playing = false;
    state.paused = true;
    state.cursor -= 1;
    directUndoPlanStep(state.cursor);
    refreshPlanUI({ scroll: true });
    scheduleDraw();
  }

  function jumpToStep(target) {
    if (!state.plan || state.active) return;
    const total = state.plan.steps.length;
    if (target < 0 || target >= total) return;
    state.playing = false;
    state.paused = true;
    while (state.cursor > target) {
      state.cursor -= 1;
      directUndoPlanStep(state.cursor);
    }
    while (state.cursor < target) {
      directApplyPlanStep(state.cursor);
      state.cursor += 1;
    }
    state.currentStage = state.plan.steps[Math.min(state.cursor, total - 1)].stageIndex;
    refreshPlanUI({ scroll: true });
    scheduleDraw();
  }

  function setPlan(plan) {
    state.plan = plan;
    state.cursor = 0;
    state.playing = false;
    state.paused = false;
    state.currentStage = 0;
    refreshPlanUI({ rebuild: true, scroll: true });
    if (plan.steps.length) {
      state.playing = true;
      state.lastFrame = performance.now();
      playNextAnimated();
    } else {
      announce("魔方已还原");
    }
    updateStatus();
  }

  async function solveCurrent() {
    elements.solveButton.classList.add("is-pressed");
    window.setTimeout(() => elements.solveButton.classList.remove("is-pressed"), 180);
    clearPendingTimeout();
    if (state.active) finishActiveImmediately();
    if (state.drag) {
      state.drag = null;
      state.graphSegmentCache = null;
    }
    state.playing = false;
    state.paused = false;
    const tokens = historySolutionTokens();
    if (tokens.length === 0 && state.cube.isSolved()) {
      setPlan(solver.makePlanFromTokens(state.cube, state.method, [], [], 0));
      refreshPlanUI({ rebuild: true });
      return;
    }
    if (!state.cube.centersAligned()) {
      if (!solver.ready) {
        state.pendingSolve = true;
        elements.solverReady.textContent = "准备完成后自动求解";
        announce("求解表正在准备，完成后自动开始");
        updateStatus();
        return;
      }
      try {
        const plan = solver.makePlan(state.cube, state.method);
        setPlan(plan);
      } catch (error) {
        elements.solverReady.textContent = "当前状态未能求解";
        announce("当前状态未能生成有效解法");
      }
      return;
    }
    try {
      const plan = solver.makePlanFromTokens(state.cube, state.method, tokens, [], 0);
      setPlan(plan);
    } catch (historyError) {
      if (!solver.ready) {
        state.pendingSolve = true;
        elements.solverReady.textContent = "准备完成后自动求解";
        announce("求解表正在准备，完成后自动开始");
        updateStatus();
        return;
      }
      try {
        const plan = solver.makePlan(state.cube, state.method);
        setPlan(plan);
      } catch (error) {
        elements.solverReady.textContent = "当前状态未能求解";
        announce("当前状态未能生成有效解法");
        updateStatus();
      }
    }
  }

  function applyDirectMoves(moves, { record = true, clearExistingPlan = true } = {}) {
    if (clearExistingPlan) clearPlan();
    for (const move of moves) {
      state.cube.applyMove(move);
      if (record) recordMove(move);
    }
    state.playing = false;
    state.paused = false;
    refreshPlanUI({ rebuild: true });
    scheduleDraw();
  }

  function scramble() {
    state.pendingSolve = false;
    clearPendingTimeout();
    state.active = null;
    state.drag = null;
    state.graphSegmentCache = null;
    const result = scrambleCube(24);
    state.cube = result.cube;
    state.history = parseSequence(result.tokens.join(" "));
    state.plan = null;
    state.cursor = 0;
    state.playing = false;
    state.paused = false;
    state.currentStage = 0;
    refreshPlanUI({ rebuild: true });
    scheduleDraw();
    announce("已打乱，可以求解当前状态");
  }

  function resetCube() {
    state.pendingSolve = false;
    clearPendingTimeout();
    state.active = null;
    state.drag = null;
    state.graphSegmentCache = null;
    state.cube = Cube.solved();
    state.history = [];
    state.plan = null;
    state.cursor = 0;
    state.playing = false;
    state.paused = false;
    state.currentStage = 0;
    refreshPlanUI({ rebuild: true });
    scheduleDraw();
    announce("魔方已复位");
  }

  function pointerPosition(event) {
    const rect = elements.cubeCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (elements.cubeCanvas.clientWidth / rect.width),
      y: (event.clientY - rect.top) * (elements.cubeCanvas.clientHeight / rect.height),
    };
  }

  function projectedTangent(hit, axis) {
    if (!renderer) return [0, 0];
    const axisVector = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const point = hit.center;
    const tangent = GL.cross(axisVector, point);
    const p0 = renderer.getMetrics() && GL.projectPoint(
      renderer.cameraViewProjection,
      point,
      renderer.cssWidth,
      renderer.cssHeight,
    );
    const p1 = GL.projectPoint(
      renderer.cameraViewProjection,
      [point[0] + tangent[0] * 0.02, point[1] + tangent[1] * 0.02, point[2] + tangent[2] * 0.02],
      renderer.cssWidth,
      renderer.cssHeight,
    );
    if (!p0 || !p1) return [0, 0];
    return [p1.x - p0.x, p1.y - p0.y];
  }

  function chooseTurnAxis(hit, dragX, dragY, shiftKey) {
    const normalAxis = hit.normal[0] !== 0 ? "x" : hit.normal[1] !== 0 ? "y" : "z";
    const candidates = [];
    for (const axis of ["x", "y", "z"]) {
      if (axis === normalAxis) continue;
      const tangent = projectedTangent(hit, axis);
      const length = Math.hypot(tangent[0], tangent[1]);
      if (length < 0.001) continue;
      const dot = dragX * tangent[0] + dragY * tangent[1];
      candidates.push({ axis, tangent, length, score: Math.abs(dot) });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;
    const chosen = candidates[0];
    const axisIndex = ["x", "y", "z"].indexOf(chosen.axis);
    const layer = hit.cubie.position[axisIndex];
    let layers = [layer];
    if (shiftKey && layer !== 0) layers = [layer, 0];
    const widths = hit.cornersScreen;
    let stickerPixels = 70;
    if (widths && widths[0] && widths[1]) {
      stickerPixels = Math.hypot(
        widths[0].x - widths[1].x,
        widths[0].y - widths[1].y,
      );
    }
    return {
      hit,
      axis: chosen.axis,
      layers,
      unit: [chosen.tangent[0] / chosen.length, chosen.tangent[1] / chosen.length],
      pixelsPerQuarter: GL.clamp(stickerPixels * 1.75, 38, 120),
    };
  }

  function beginPointer(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (state.active || state.drag) return;
    if (state.playing) {
      clearPendingTimeout();
      state.playing = false;
      state.paused = true;
      updateStatus();
    }
    const pos = pointerPosition(event);
    const hit = renderer ? renderer.hitTestSticker(state.cube, pos.x, pos.y) : null;
    elements.cubeCanvas.setPointerCapture?.(event.pointerId);
    if (hit) {
      state.drag = {
        kind: "turn",
        pointerId: event.pointerId,
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        hit,
        move: null,
        q: 0,
      };
    } else {
      state.drag = {
        kind: "orbit",
        pointerId: event.pointerId,
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
      };
      if (renderer) {
        renderer.velocityYaw = 0;
        renderer.velocityPitch = 0;
      }
    }
    event.preventDefault();
  }

  function movePointer(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const pos = pointerPosition(event);
    const dx = pos.x - state.drag.startX;
    const dy = pos.y - state.drag.startY;
    if (state.drag.kind === "orbit") {
      const moveX = pos.x - state.drag.lastX;
      const moveY = pos.y - state.drag.lastY;
      state.drag.lastX = pos.x;
      state.drag.lastY = pos.y;
      if (renderer) renderer.orbit(moveX, moveY);
      startCameraInertia();
      scheduleDraw();
      event.preventDefault();
      return;
    }
    if (Math.hypot(dx, dy) < 4 && !state.drag.move) return;
    if (!state.drag.move) {
      const choice = chooseTurnAxis(state.drag.hit, dx, dy, event.shiftKey);
      if (!choice) return;
      state.drag.move = {
        axis: choice.axis,
        layers: choice.layers,
        angle: 1,
        name: "",
        label: "",
      };
      state.drag.unit = choice.unit;
      state.drag.pixelsPerQuarter = choice.pixelsPerQuarter;
    }
    const along = dx * state.drag.unit[0] + dy * state.drag.unit[1];
    const q = GL.clamp(along / state.drag.pixelsPerQuarter, -2.7, 2.7);
    state.drag.q = q;
    const signedMove = moveForLayers(state.drag.move.axis, state.drag.move.layers, q >= 0 ? 1 : -1);
    state.drag.move.label = signedMove.label;
    scheduleDraw();
    event.preventDefault();
  }

  function endPointer(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    elements.cubeCanvas.releasePointerCapture?.(event.pointerId);
    if (state.drag.kind === "orbit") {
      state.drag = null;
      if (renderer) renderer.velocityYaw *= 0.85;
      startCameraInertia();
      return;
    }
    if (!state.drag.move) {
      state.drag = null;
      return;
    }
    const rawTarget = Math.round(state.drag.q);
    let target = Math.abs(rawTarget) >= 3 ? (rawTarget > 0 ? -1 : 1) : rawTarget;
    target = GL.clamp(target, -2, 2);
    const baseMove = moveForLayers(
      state.drag.move.axis,
      state.drag.move.layers,
      target || 1,
    );
    let fromQ = state.drag.q;
    if (Math.abs(rawTarget) >= 3) fromQ -= Math.sign(rawTarget) * 4;
    state.drag = null;
    startActiveMove(baseMove, fromQ, target, {
      duration: Math.max(0.1, Math.abs(target - fromQ) * (Math.abs(target) === 2 ? 0.215 : 0.3)),
      commit: target !== 0,
      manual: true,
    });
    event.preventDefault();
  }

  function cancelPointer(event) {
    if (!state.drag || (event && state.drag.pointerId !== event.pointerId)) return;
    state.drag = null;
    state.graphSegmentCache = null;
    scheduleDraw();
  }

  function handleWheel(event) {
    if (!renderer) return;
    event.preventDefault();
    const nextZoom = GL.clamp(renderer.userZoom * Math.exp(-event.deltaY * 0.0009), 0.72, 1.12);
    renderer.setCamera(renderer.yaw, renderer.pitch, nextZoom);
    scheduleDraw();
  }

  function startCameraInertia() {
    if (state.cameraFrame !== null) return;
    state.lastCameraTime = performance.now();
    const tick = (timestamp) => {
      state.cameraFrame = null;
      if (!renderer || (state.drag && state.drag.kind === "orbit")) return;
      const dt = Math.min(0.05, Math.max(0, (timestamp - state.lastCameraTime) / 1000));
      state.lastCameraTime = timestamp;
      if (renderer.updateInertia(dt)) {
        scheduleDraw();
        state.cameraFrame = requestAnimationFrame(tick);
      }
    };
    state.cameraFrame = requestAnimationFrame(tick);
  }

  function handleResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const dpr = window.devicePixelRatio || 1;
      if (renderer) renderer.resize(dpr);
      if (graphView) graphView.resize(dpr);
      scheduleDraw();
    });
  }

  function watchDpr() {
    if (disposeDprWatch) disposeDprWatch();
    const dpr = window.devicePixelRatio || 1;
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => {
      handleResize();
      watchDpr();
    };
    if (media.addEventListener) {
      media.addEventListener("change", onChange, { once: true });
      disposeDprWatch = () => media.removeEventListener("change", onChange);
    } else if (media.addListener) {
      media.addListener(onChange);
      disposeDprWatch = () => media.removeListener(onChange);
    }
  }

  function setupObservers() {
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("scroll", handleResize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleResize, { passive: true });
      window.visualViewport.addEventListener("scroll", handleResize, { passive: true });
    }
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(handleResize);
      if (elements.meshStage) observer.observe(elements.meshStage);
      if (elements.graphStage) observer.observe(elements.graphStage);
      observer.observe(elements.cubeCanvas);
      observer.observe(elements.graphCanvas);
    }
    watchDpr();
  }

  function bindEvents() {
    elements.scrambleButton.addEventListener("click", scramble);
    elements.resetButton.addEventListener("click", resetCube);
    elements.solveButton.addEventListener("click", solveCurrent);
    elements.playButton.addEventListener("click", play);
    elements.pauseButton.addEventListener("click", pause);
    elements.prevButton.addEventListener("click", previousStep);
    elements.nextButton.addEventListener("click", nextStep);
    elements.resetView.addEventListener("click", () => {
      if (renderer) renderer.resetCamera();
      scheduleDraw();
    });
    elements.methodButtons.forEach((button) => {
      button.addEventListener("click", () => setMethod(button.dataset.method));
    });
    elements.speedSlider.addEventListener("input", () => {
      state.speed = Number(elements.speedSlider.value);
      elements.speedValue.textContent = `${state.speed.toFixed(1)}×`;
    });
    elements.cubeCanvas.addEventListener("pointerdown", beginPointer);
    elements.cubeCanvas.addEventListener("pointermove", movePointer);
    elements.cubeCanvas.addEventListener("pointerup", endPointer);
    elements.cubeCanvas.addEventListener("pointercancel", cancelPointer);
    elements.cubeCanvas.addEventListener("wheel", handleWheel, { passive: false });
    elements.cubeCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        previousStep();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        nextStep();
      }
    });
  }

  function startSolverWarmup() {
    window.setTimeout(async () => {
      if (solver.ready) {
        elements.solverReady.textContent = "求解就绪";
        return;
      }
      try {
        await solver.prepare((progress) => {
          if (!state.pendingSolve) {
            elements.solverReady.textContent = `背景准备 ${Math.round(progress * 100)}%`;
          }
        });
        elements.solverReady.textContent = "求解就绪";
        if (state.pendingSolve) {
          state.pendingSolve = false;
          solveCurrent();
        }
      } catch (error) {
        elements.solverReady.textContent = "后台表准备失败";
      }
    }, 280);
  }

  function exposeApi() {
    window.CubeLabApp = {
      applySequence(text, options = {}) {
        const moves = parseSequence(text);
        applyDirectMoves(moves, { record: options.record !== false, clearExistingPlan: true });
        return this.getState();
      },
      scramble(length = 24) {
        const result = scrambleCube(length);
        state.cube = result.cube;
        state.history = parseSequence(result.tokens.join(" "));
        state.plan = null;
        state.cursor = 0;
        state.playing = false;
        state.paused = false;
        refreshPlanUI({ rebuild: true });
        scheduleDraw();
        return result.tokens;
      },
      solve() {
        return solveCurrent();
      },
      play,
      pause,
      next: nextStep,
      previous: previousStep,
      reset: resetCube,
      setMethod,
      setSpeed(value) {
        const clamped = GL.clamp(Number(value), 0.2, 3);
        state.speed = clamped;
        elements.speedSlider.value = String(clamped);
        elements.speedValue.textContent = `${clamped.toFixed(1)}×`;
      },
      getState() {
        return {
          method: state.method,
          solved: state.cube.isSolved(),
          stickers: RENDER_SLOT_SNAPSHOT(state.cube),
          plan: state.plan ? state.plan.steps.map((step) => ({ ...step })) : null,
          stages: state.plan ? state.plan.stages.map((stage) => ({ ...stage })) : null,
          cursor: state.cursor,
          playing: state.playing,
          paused: state.paused,
          active: !!state.active,
          activeProgress: state.active ? state.active.progress : null,
          activeQ: state.active ? state.active.q : null,
          dragging: state.drag ? state.drag.kind : null,
          dragQ: state.drag && state.drag.kind === "turn" ? state.drag.q : null,
          history: state.history.map((move) => ({ ...move, layers: move.layers.slice() })),
        };
      },
      getMetrics() {
        const cubeMetrics = renderer ? renderer.getMetrics() : null;
        const graphRect = elements.graphCanvas.getBoundingClientRect();
        const graphGraphic = graphView && graphView.view ? graphView.view.graphBounds : null;
        return {
          cube: cubeMetrics,
          graph: {
            cssWidth: graphRect.width,
            cssHeight: graphRect.height,
            pixelWidth: elements.graphCanvas.width,
            pixelHeight: elements.graphCanvas.height,
            dpr: graphView ? graphView.dpr : null,
            graphic: graphGraphic,
            labels: graphView ? graphView.labels.map((label) => ({
              face: label.face,
              x: label.x,
              y: label.y,
              width: label.width,
              height: label.height,
              text: label.text,
            })) : [],
            nodes: graphView ? Graph.EMBEDDING.nodes.map((node) => {
              const point = graphView.toScreen(node);
              return {
                face: node.face,
                slot: node.slotKey,
                x: point.x,
                y: point.y,
                center: node.isCenter,
                radius: graphRect.width < 340 ? 3.65 : 4.05,
              };
            }) : [],
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio || 1,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollHeight: document.documentElement.scrollHeight,
          },
        };
      },
      flushSizes: handleResize,
      triggerResize: handleResize,
      getVisibleStickers() {
        if (!renderer) return [];
        return renderer.stickerQuads(state.cube)
          .filter((quad) => {
            const toCamera = GL.normalize(GL.subtract(renderer.cameraPosition, quad.center));
            return GL.dot(quad.normal, toCamera) > 0.08 && quad.centerScreen;
          })
          .map((quad) => ({
            color: quad.sticker.color,
            face: quad.sticker.homeFace,
            x: quad.centerScreen.x,
            y: quad.centerScreen.y,
            normal: quad.normal.slice(),
            position: quad.cubie.position.slice(),
            corners: quad.cornersScreen.map((corner) => corner ? {
              x: corner.x,
              y: corner.y,
            } : null),
          }));
      },
      hitStickerAt(x, y) {
        const hit = renderer ? renderer.hitTestSticker(state.cube, x, y) : null;
        return hit ? {
          color: hit.sticker.color,
          normal: hit.normal.slice(),
          position: hit.cubie.position.slice(),
        } : null;
      },
      sampleCubeFrame() {
        return renderer ? renderer.sampleFrame(state.cube) : null;
      },
      sampleGraphFrame() {
        if (!graphView || !graphView.ctx) return null;
        const image = graphView.ctx.getImageData(
          0,
          0,
          elements.graphCanvas.width,
          elements.graphCanvas.height,
        );
        let colored = 0;
        let opaque = 0;
        const colors = new Set();
        for (let i = 0; i < image.data.length; i += 4 * 23) {
          const r = image.data[i];
          const g = image.data[i + 1];
          const b = image.data[i + 2];
          const a = image.data[i + 3];
          if (a > 10) opaque += 1;
          if (a > 10 && (Math.abs(r - g) > 8 || Math.abs(g - b) > 8)) colored += 1;
          colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
        }
        return {
          width: elements.graphCanvas.width,
          height: elements.graphCanvas.height,
          opaque,
          colored,
          uniqueColors: colors.size,
        };
      },
    };
  }

  function RENDER_SLOT_SNAPSHOT(cube) {
    const table = cube.stickerTable();
    return Object.keys(table).sort().map((key) => ({
      slot: key,
      color: table[key].color,
    }));
  }

  bindEvents();
  setupObservers();
  renderStageCards();
  renderRuler();
  buildStepList();
  updateStatus();
  exposeApi();
  requestAnimationFrame(() => {
    handleResize();
    drawFrame();
  });
  startSolverWarmup();
})();
