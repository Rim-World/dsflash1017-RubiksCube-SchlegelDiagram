"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..", "..");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outputDir = path.join(__dirname, "out");
fs.mkdirSync(outputDir, { recursive: true });
const profile = path.join(os.tmpdir(), `cube-atlas-e2e-${process.pid}`);
const port = 9400 + (process.pid % 300);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CDP {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve);
      this.socket.addEventListener("error", reject);
    });
    this.socket.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data);
      if (payload.id) {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        if (payload.error) pending.reject(new Error(payload.error.message));
        else pending.resolve(payload.result);
      } else {
        this.events.push(payload);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.socket.close();
  }
}

async function waitForDebugTarget(portNumber) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/json/list`);
      if (response.ok) {
        const items = await response.json();
        const page = items.find((item) => item.type === "page");
        if (page) return page;
      }
    } catch (error) {
      // The debugging endpoint is not ready yet.
    }
    await sleep(150);
  }
  throw new Error("浏览器调试端口未就绪。");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "页面求值失败。");
  }
  return result.result.value;
}

async function viewport(cdp, width, height, dpr = 1) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile: false,
    scale: 1,
  });
  await sleep(260);
}

async function screenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(outputDir, name);
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  return file;
}

async function mouseDrag(cdp, { x, y, dx, dy, modifiers = 0, steps = 5 }) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x + dx * step / steps,
      y: y + dy * step / steps,
      button: "left",
      buttons: 1,
      modifiers,
    });
    await sleep(20);
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x + dx,
    y: y + dy,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
}

async function main() {
  const browser = spawn(edge, [
    "--headless=new",
    "--no-first-run",
    "--disable-extensions",
    "--hide-scrollbars",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], {
    windowsHide: true,
    stdio: "ignore",
  });

  let cdp;
  const consoleErrors = [];
  const failedRequests = [];
  const externalRequests = [];
  try {
    const target = await waitForDebugTarget(port);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await viewport(cdp, 1440, 900, 1);
    await cdp.send("Page.navigate", { url: pathToFileURL(path.join(root, "index.html")).href });
    await sleep(1300);
    const appReady = await evaluate(cdp, "!!window.CubeLabApp");
    assert.equal(appReady, true, "应用未完成初始化");

    const initial = await evaluate(cdp, `(() => {
      const app = window.CubeLabApp;
      const metrics = app.getMetrics();
      const text = document.body.innerText;
      return {
        metrics,
        state: app.getState(),
        sampleCube: app.sampleCubeFrame(),
        sampleGraph: app.sampleGraphFrame(),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: innerHeight,
        text,
      };
    })()`);
    assert.equal(initial.scrollWidth, initial.clientWidth, "1440 宽度出现横向滚动");
    assert.ok(
      initial.scrollHeight <= initial.innerHeight + 1,
      `1440 × 900 首屏出现纵向滚动：${initial.scrollHeight} > ${initial.innerHeight}`,
    );
    assert.ok(initial.metrics.cube.bboxWidthFraction >= 0.58);
    assert.ok(initial.metrics.cube.bboxWidthFraction <= 0.72);
    assert.ok(initial.metrics.graph.graphic.maxX - initial.metrics.graph.graphic.minX >= 300);
    assert.ok(initial.metrics.graph.graphic.maxY - initial.metrics.graph.graphic.minY >= 260);
    assert.ok(initial.sampleCube.uniqueColors > 20, "三维画布没有足够可见像素");
    assert.ok(initial.sampleGraph.uniqueColors > 20, "图论画布没有足够可见像素");
    const initialGraphLayout = await evaluate(cdp, `(() => {
      const metrics = window.CubeLabApp.getMetrics();
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = '10px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", "Microsoft YaHei", monospace';
      const labels = metrics.graph.labels;
      const nodes = metrics.graph.nodes;
      const problems = [];
      if (labels.length !== 6) problems.push('标签数量不是 6');
      for (const label of labels) {
        if (label.x < 4 || label.y < 4 ||
            label.x + label.width > metrics.graph.cssWidth - 4 ||
            label.y + label.height > metrics.graph.cssHeight - 4) {
          problems.push(label.face + ' 标签超出画布');
        }
        if (label.width < 44) problems.push(label.face + ' 标签宽度小于 44');
        if (label.width < measure.measureText(label.text).width + 16 - 0.5) {
          problems.push(label.face + ' 标签未包住文字');
        }
        for (const node of nodes) {
          const nx = Math.max(label.x, Math.min(node.x, label.x + label.width));
          const ny = Math.max(label.y, Math.min(node.y, label.y + label.height));
          if (Math.hypot(node.x - nx, node.y - ny) < node.radius + 4) {
            problems.push(label.face + ' 标签压住球点');
            break;
          }
        }
      }
      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          const a = labels[i];
          const b = labels[j];
          if (!(a.x + a.width <= b.x || b.x + b.width <= a.x ||
                a.y + a.height <= b.y || b.y + b.height <= a.y)) {
            problems.push(a.face + ' 与 ' + b.face + ' 标签相交');
          }
        }
      }
      if (nodes.length !== 54) problems.push('节点数量不是 54');
      if (nodes.some((node) =>
        node.x - node.radius < 0 ||
        node.y - node.radius < 0 ||
        node.x + node.radius > metrics.graph.cssWidth ||
        node.y + node.radius > metrics.graph.cssHeight)) {
        problems.push('球点越出画布');
      }
      const centers = Object.fromEntries(labels.map((label) => [
        label.face,
        { x: label.x + label.width / 2, y: label.y + label.height / 2 },
      ]));
      if (!(centers.U.y < centers.L.y && centers.U.y < centers.B.y &&
            centers.L.y < centers.F.y && centers.B.y < centers.R.y &&
            centers.F.y < centers.D.y && centers.R.y < centers.D.y)) {
        problems.push('面标签纵向顺序错误');
      }
      if (!(centers.L.x < centers.U.x && centers.U.x < centers.B.x &&
            centers.F.x < centers.D.x && centers.D.x < centers.R.x)) {
        problems.push('面标签横向顺序错误');
      }
      return { problems, labels, nodes, centers };
    })()`);
    assert.deepEqual(initialGraphLayout.problems, [], initialGraphLayout.problems.join("；"));
    await screenshot(cdp, "01-initial-1440x900.png");

    const layout = await evaluate(cdp, `(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
      };
      return {
        playbar: rect(".playbar"),
        mesh: rect(".mesh-panel"),
        graph: rect(".graph-panel"),
        solver: rect(".solver-panel"),
        stepList: rect("#stepList"),
      };
    })()`);
    assert.ok(layout.playbar.bottom <= 900.5, "播放条不在 1440 × 900 首屏内");

    const rouxUi = await evaluate(cdp, `(() => {
      document.querySelector('[data-method="ROUX"]').click();
      return {
        subtitle: document.querySelector('#methodSubtitle').textContent.trim(),
        stages: Array.from(document.querySelectorAll('.stage-card b')).map((node) => node.textContent),
      };
    })()`);
    assert.equal(rouxUi.subtitle, "ROUX / BLOCKS");
    assert.deepEqual(rouxUi.stages, ["FB", "SB", "CMLL", "LSE"]);
    await evaluate(cdp, "document.querySelector('[data-method=\"CFOP\"]').click()");

    await evaluate(cdp, `(() => {
      window.CubeLabApp.scramble(24);
      window.CubeLabApp.solve();
      return true;
    })()`);
    await sleep(460);
    await evaluate(cdp, "window.CubeLabApp.pause()");
    await sleep(380);
    const solvedPlan = await evaluate(cdp, `(() => {
      const list = document.querySelector('#stepList');
      const rows = Array.from(list.querySelectorAll('.step-row')).map((row) => {
        const box = row.getBoundingClientRect();
        const listBox = list.getBoundingClientRect();
        return {
          text: row.innerText,
          fullyVisible: box.top >= listBox.top - 0.5 && box.bottom <= listBox.bottom + 0.5,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
        };
      });
      const cards = Array.from(document.querySelectorAll('.stage-card')).map((card) => card.innerText);
      const completeToken = document.querySelector('.step-row.is-complete .step-token');
      const pendingToken = document.querySelector('.step-row:not(.is-complete) .step-token');
      return {
        state: window.CubeLabApp.getState(),
        rows,
        cards,
        bodyText: document.body.innerText,
        listHeight: list.clientHeight,
        listTop: list.getBoundingClientRect().top,
        listBottom: list.getBoundingClientRect().bottom,
        sealClass: document.querySelector('#solvedSeal').className,
        sealOpacity: getComputedStyle(document.querySelector('#solvedSeal')).opacity,
        groupCount: document.querySelectorAll('.stage-group-title').length,
        renderedStyles: {
          stagePercent: parseFloat(getComputedStyle(document.querySelector('.stage-percent')).fontSize),
          stageSteps: parseFloat(getComputedStyle(document.querySelector('.stage-steps')).fontSize),
          stepToken: parseFloat(getComputedStyle(document.querySelector('.step-token')).fontSize),
          solveButton: parseFloat(getComputedStyle(document.querySelector('#solveButton')).fontSize),
          counter: parseFloat(getComputedStyle(document.querySelector('#stepCounter')).fontSize),
          pauseBadge: parseFloat(getComputedStyle(document.querySelector('#pauseBadge')).fontSize),
        },
        opacity: {
          complete: completeToken ? Number(getComputedStyle(completeToken).opacity) : null,
          pending: pendingToken ? Number(getComputedStyle(pendingToken).opacity) : null,
        },
        completedCount: document.querySelectorAll('.step-row.is-complete').length,
        truncated: Array.from(document.querySelectorAll('.step-description')).some((node) =>
          node.scrollWidth > node.clientWidth + 1 ||
          getComputedStyle(node).textOverflow === 'ellipsis'),
      };
    })()`);
    await screenshot(cdp, "02-plan-1440x900.png");
    assert.ok(solvedPlan.state.plan && solvedPlan.state.plan.length > 0, "未生成求解计划");
    assert.ok(
      solvedPlan.rows.filter((row) => row.fullyVisible).length >= 8,
      `首屏可见步骤不足 8 行：${JSON.stringify({
        listTop: solvedPlan.listTop,
        listBottom: solvedPlan.listBottom,
        listHeight: solvedPlan.listHeight,
        visible: solvedPlan.rows.map((row) => row.fullyVisible),
        heights: solvedPlan.rows.slice(0, 10).map((row) => row.height),
      })}`,
    );
    assert.equal(solvedPlan.state.solved, false, "未完成计划时不应显示已还原");
    assert.equal(new Set(solvedPlan.state.stickers.map((sticker) => sticker.color)).size, 6);
    assert.equal(solvedPlan.sealClass.includes("is-hidden"), true, "已还原印章未淡出");
    assert.ok(solvedPlan.groupCount >= 1, "步骤列表缺少阶段分组标题");
    assert.ok(solvedPlan.completedCount > 0, "暂停后没有已完成步骤");
    assert.ok(solvedPlan.opacity.complete >= solvedPlan.opacity.pending, "已完成步骤 token 更淡");
    assert.ok(Object.values(solvedPlan.renderedStyles).every((size) => size >= 10 - 0.01), "关键信息字号小于 10 px");
    assert.equal(solvedPlan.truncated, false, "步骤说明被截断");

    const keyboardStart = await evaluate(cdp, "window.CubeLabApp.getState()");
    await evaluate(cdp, `document.body.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true
    }))`);
    await sleep(80);
    const afterRight = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(afterRight.cursor, keyboardStart.cursor + 1, "右方向键没有执行下一步");
    await evaluate(cdp, `document.body.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true, cancelable: true
    }))`);
    await sleep(80);
    const afterLeft = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(afterLeft.cursor, keyboardStart.cursor, "左方向键没有执行上一步");
    await evaluate(cdp, `document.body.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Space', key: ' ', bubbles: true, cancelable: true
    }))`);
    await sleep(80);
    const afterSpacePlay = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(afterSpacePlay.playing, true, "空格键没有开始播放");
    await evaluate(cdp, `document.body.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Space', key: ' ', bubbles: true, cancelable: true
    }))`);
    await sleep(420);
    const afterSpacePause = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(afterSpacePause.paused, true, "空格键没有切换暂停");
    let settledState = afterSpacePause;
    const settleDeadline = Date.now() + 2500;
    while (settledState.active && Date.now() < settleDeadline) {
      await sleep(100);
      settledState = await evaluate(cdp, "window.CubeLabApp.getState()");
    }
    assert.equal(settledState.active, false, "暂停后当前转动未能结束");
    assert.ok(solvedPlan.listHeight >= 140, "桌面步骤列表可见高度不足 140 px");
    const percentages = solvedPlan.cards.map((text) => Number((text.match(/(\d+)%/) || [0, 0])[1]));
    assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100, "阶段百分比合计不为 100");
    assert.ok(!/\bROT\b|\bFPS\b/.test(solvedPlan.bodyText), "页面出现调试读数");

    const beforeResize = await evaluate(cdp, `(() => {
      const app = window.CubeLabApp;
      return {
        state: app.getState(),
        metrics: app.getMetrics(),
      };
    })()`);
    await viewport(cdp, 1000, 900, 1);
    const after1000 = await evaluate(cdp, `(() => ({
      state: window.CubeLabApp.getState(),
      metrics: window.CubeLabApp.getMetrics(),
      sampleCube: window.CubeLabApp.sampleCubeFrame(),
      sampleGraph: window.CubeLabApp.sampleGraphFrame(),
    }))()`);
    assert.equal(
      after1000.state.cursor,
      beforeResize.state.cursor,
      `缩放改变了当前步：${JSON.stringify({
        before: {
          cursor: beforeResize.state.cursor,
          active: beforeResize.state.active,
          paused: beforeResize.state.paused,
          playing: beforeResize.state.playing,
        },
        after: {
          cursor: after1000.state.cursor,
          active: after1000.state.active,
          paused: after1000.state.paused,
          playing: after1000.state.playing,
        },
      })}`,
    );
    assert.equal(after1000.metrics.cube.yaw, beforeResize.metrics.cube.yaw);
    assert.equal(after1000.metrics.cube.zoom, beforeResize.metrics.cube.zoom);
    assert.equal(after1000.metrics.cube.pixelWidth, Math.round(after1000.metrics.cube.cssWidth * 1));
    assert.ok(after1000.sampleCube.nonPaperRatio > 0.02);
    await screenshot(cdp, "03-resize-1000x900.png");

    await viewport(cdp, 1440, 900, 1);
    await viewport(cdp, 1440, 720, 1);
    const compact = await evaluate(cdp, `(() => {
      const list = document.querySelector('#stepList');
      const listBox = list.getBoundingClientRect();
      const rows = Array.from(list.querySelectorAll('.step-row'));
      return {
        visibleRows: rows.filter((row) => {
          const box = row.getBoundingClientRect();
          return box.top >= listBox.top - 0.5 && box.bottom <= listBox.bottom + 0.5;
        }).length,
        playbarTop: document.querySelector('.playbar').getBoundingClientRect().top,
        scrollHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert.ok(compact.visibleRows >= 6, "1440 × 720 下步骤不足 6 行");
    assert.equal(compact.scrollWidth, compact.clientWidth);
    await viewport(cdp, 1440, 900, 1);

    for (const dpr of [1.25, 2]) {
      await viewport(cdp, 1440, 900, dpr);
      await evaluate(cdp, "window.CubeLabApp.triggerResize()");
      await sleep(220);
      const dprResult = await evaluate(cdp, `(() => {
        return {
          state: window.CubeLabApp.getState(),
          metrics: window.CubeLabApp.getMetrics(),
          sampleCube: window.CubeLabApp.sampleCubeFrame(),
          sampleGraph: window.CubeLabApp.sampleGraphFrame(),
        };
      })()`);
      assert.equal(dprResult.metrics.cube.pixelWidth, Math.round(dprResult.metrics.cube.cssWidth * dpr));
      assert.equal(dprResult.metrics.cube.pixelHeight, Math.round(dprResult.metrics.cube.cssHeight * dpr));
      assert.equal(dprResult.metrics.graph.pixelWidth, Math.round(dprResult.metrics.graph.cssWidth * dpr));
      assert.equal(dprResult.metrics.graph.pixelHeight, Math.round(dprResult.metrics.graph.cssHeight * dpr));
      assert.equal(dprResult.state.cursor, beforeResize.state.cursor);
      assert.ok(dprResult.sampleCube.nonPaperRatio > 0.02);
      await screenshot(cdp, `04-dpr-${String(dpr).replace(".", "_")}.png`);
    }

    await viewport(cdp, 1440, 900, 1);
    for (const zoom of [0.8, 1.25, 1.5, 2]) {
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: zoom });
      await sleep(160);
      const zoomResult = await evaluate(cdp, `(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        metrics: window.CubeLabApp.getMetrics(),
      }))()`);
      assert.ok(zoomResult.scrollWidth <= zoomResult.clientWidth + 1);
    }
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    const beforeZoomLayout = await evaluate(cdp, "window.CubeLabApp.getState()");
    for (const zoom of [0.8, 1.25, 1.5, 2]) {
      const cssWidth = Math.round(1440 / zoom);
      const cssHeight = Math.round(900 / zoom);
      await viewport(cdp, cssWidth, cssHeight, 1);
      const zoomLayout = await evaluate(cdp, `(() => ({
        state: window.CubeLabApp.getState(),
        metrics: window.CubeLabApp.getMetrics(),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        sampleCube: window.CubeLabApp.sampleCubeFrame(),
      }))()`);
      assert.ok(zoomLayout.scrollWidth <= zoomLayout.clientWidth + 1);
      assert.equal(zoomLayout.state.cursor, beforeZoomLayout.cursor);
      assert.ok(zoomLayout.sampleCube.nonPaperRatio > 0.02);
      assert.equal(
        zoomLayout.metrics.cube.pixelWidth,
        Math.round(zoomLayout.metrics.cube.cssWidth),
      );
    }
    await viewport(cdp, 1440, 900, 1);

    await viewport(cdp, 390, 844, 1);
    const mobile = await evaluate(cdp, `(() => ({
      metrics: window.CubeLabApp.getMetrics(),
      state: window.CubeLabApp.getState(),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      sampleCube: window.CubeLabApp.sampleCubeFrame(),
      sampleGraph: window.CubeLabApp.sampleGraphFrame(),
    }))()`);
    await screenshot(cdp, "05-mobile-390x844.png");
    assert.equal(mobile.scrollWidth, mobile.clientWidth, "390 宽度出现横向滚动");
    assert.ok(
      mobile.metrics.cube.bboxWidthFraction >= 0.78,
      `移动端魔方宽度不足：${JSON.stringify(mobile.metrics.cube)}`,
    );
    assert.ok(mobile.metrics.cube.bboxWidthFraction <= 0.9);
    assert.ok(mobile.metrics.graph.graphic.maxX - mobile.metrics.graph.graphic.minX >= 300);
    assert.ok(mobile.metrics.graph.graphic.maxY - mobile.metrics.graph.graphic.minY >= 260);
    assert.ok(mobile.sampleCube.nonPaperRatio > 0.02);
    await evaluate(cdp, "document.querySelector('#map').scrollIntoView({ block: 'start' })");
    await sleep(160);
    await screenshot(cdp, "09-mobile-map-390x844.png");
    await evaluate(cdp, "document.querySelector('#solver').scrollIntoView({ block: 'start' })");
    await sleep(160);
    await screenshot(cdp, "10-mobile-solver-390x844.png");
    await evaluate(cdp, "window.scrollTo(0, 0)");
    const mobileLabelProblems = await evaluate(cdp, `(() => {
      const metrics = window.CubeLabApp.getMetrics();
      const labels = metrics.graph.labels;
      const nodes = metrics.graph.nodes;
      const problems = [];
      for (const label of labels) {
        if (label.x < 4 || label.y < 4 ||
            label.x + label.width > metrics.graph.cssWidth - 4 ||
            label.y + label.height > metrics.graph.cssHeight - 4) {
          problems.push(label.face + ' 标签越界');
        }
        for (const node of nodes) {
          const nx = Math.max(label.x, Math.min(node.x, label.x + label.width));
          const ny = Math.max(label.y, Math.min(node.y, label.y + label.height));
          if (Math.hypot(node.x - nx, node.y - ny) < node.radius + 4) {
            problems.push(label.face + ' 标签压住球点');
            break;
          }
        }
      }
      return problems;
    })()`);
    assert.deepEqual(mobileLabelProblems, [], mobileLabelProblems.join("；"));

    await viewport(cdp, 320, 844, 1);
    const narrow = await evaluate(cdp, `(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      metrics: window.CubeLabApp.getMetrics(),
      overflow: Array.from(document.querySelectorAll('body *')).filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
      }).slice(0, 8).map((node) => ({
        tag: node.tagName,
        id: node.id,
        className: typeof node.className === 'string' ? node.className : '',
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
      })),
    }))()`);
    await screenshot(cdp, "07-narrow-320x844.png");
    assert.equal(narrow.scrollWidth, narrow.clientWidth, "320 宽度出现横向滚动");
    assert.deepEqual(narrow.overflow, [], "320 宽度存在横向越界元素");

    await evaluate(cdp, `(() => {
      window.CubeLabApp.setSpeed(0.2);
      window.CubeLabApp.scramble(20);
      window.CubeLabApp.solve();
      return true;
    })()`);
    await sleep(120);
    const duringBefore = await evaluate(cdp, "window.CubeLabApp.getState()");
    await viewport(cdp, 1000, 844, 1.25);
    await sleep(120);
    const duringAfter = await evaluate(cdp, `(() => ({
      state: window.CubeLabApp.getState(),
      metrics: window.CubeLabApp.getMetrics(),
      sampleCube: window.CubeLabApp.sampleCubeFrame(),
      sampleGraph: window.CubeLabApp.sampleGraphFrame(),
    }))()`);
    assert.equal(duringAfter.state.cursor, duringBefore.cursor);
    assert.equal(duringAfter.metrics.cube.yaw, 0.62);
    assert.ok(duringAfter.sampleGraph.uniqueColors > 20);

    await viewport(cdp, 1440, 900, 1);
    await evaluate(cdp, `(() => {
      window.CubeLabApp.setSpeed(1);
      window.CubeLabApp.reset();
      return true;
    })()`);
    await sleep(160);
    const dragPoint = await evaluate(cdp, `(() => {
      const canvas = document.querySelector('#cubeCanvas');
      const rect = canvas.getBoundingClientRect();
      const stickers = window.CubeLabApp.getVisibleStickers();
      const targetX = rect.left + rect.width * 0.5;
      const targetY = rect.top + rect.height * 0.53;
      const sticker = stickers.reduce((best, item) => {
        const distance = Math.hypot(item.x + rect.left - targetX, item.y + rect.top - targetY);
        return !best || distance < best.distance ? { item, distance } : best;
      }, null).item;
      const centerSticker = stickers.find((item) =>
        item.position.filter((value) => value === 0).length === 2);
      return {
        x: rect.left + sticker.x,
        y: rect.top + sticker.y,
        hit: window.CubeLabApp.hitStickerAt(sticker.x, sticker.y),
        sticker,
        centerSticker: centerSticker ? {
          x: rect.left + centerSticker.x,
          y: rect.top + centerSticker.y,
          value: centerSticker,
        } : null,
        canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    })()`);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: dragPoint.x,
      y: dragPoint.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: dragPoint.x + step * 28,
        y: dragPoint.y,
        button: "left",
        buttons: 1,
      });
      await sleep(20);
    }
    const dragDuring = await evaluate(cdp, "window.CubeLabApp.getState()");
    await screenshot(cdp, "08-drag-turn-1440x900.png");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragPoint.x + 140,
      y: dragPoint.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(520);
    const dragged = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(
      dragged.history.length,
      1,
      `拖动没有提交一次转层：${JSON.stringify({ hit: dragPoint.hit, during: dragDuring, after: dragged })}`,
    );
    assert.ok(Math.abs(dragged.history[0].angle) <= 2, "拖动提交方向不是最短转动");
    assert.equal(dragged.solved, false, "拖动后魔方仍显示还原");

    await evaluate(cdp, "window.CubeLabApp.reset()");
    assert.ok(dragPoint.centerSticker, "未找到面中心贴纸");
    await mouseDrag(cdp, {
      x: dragPoint.centerSticker.x,
      y: dragPoint.centerSticker.y,
      dx: 140,
      dy: 0,
    });
    await sleep(520);
    const sliceDragged = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(sliceDragged.history.length, 1, "面中心拖动没有提交中层转动");
    assert.deepEqual(sliceDragged.history[0].layers, [0], "面中心拖动没有选中坐标 0 的层");

    await evaluate(cdp, "window.CubeLabApp.reset()");
    await sleep(100);
    await mouseDrag(cdp, {
      x: dragPoint.x,
      y: dragPoint.y,
      dx: 140,
      dy: 0,
      modifiers: 8,
    });
    await sleep(520);
    const wideDragged = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.equal(wideDragged.history.length, 1, "Shift 拖动没有提交宽层转动");
    assert.equal(wideDragged.history[0].layers.length, 2, "Shift 拖动没有带动相邻中间层");

    await evaluate(cdp, "window.CubeLabApp.reset()");
    await sleep(120);
    const beforeOrbit = await evaluate(cdp, "window.CubeLabApp.getMetrics().cube.yaw");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: dragPoint.canvas.left + 24,
      y: dragPoint.canvas.top + dragPoint.canvas.height * 0.52,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragPoint.canvas.left + 78,
      y: dragPoint.canvas.top + dragPoint.canvas.height * 0.52 + 18,
      button: "left",
      buttons: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragPoint.canvas.left + 78,
      y: dragPoint.canvas.top + dragPoint.canvas.height * 0.52 + 18,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(120);
    const afterOrbit = await evaluate(cdp, "window.CubeLabApp.getMetrics().cube.yaw");
    assert.notEqual(afterOrbit, beforeOrbit, "空白拖动没有旋转视角");
    await evaluate(cdp, "document.querySelector('#resetView').click()");
    await evaluate(cdp, `document.querySelector('#cubeCanvas').dispatchEvent(
      new WheelEvent('wheel', { deltaY: -260, bubbles: true, cancelable: true })
    )`);
    await sleep(100);
    const zoomed = await evaluate(cdp, "window.CubeLabApp.getMetrics().cube.zoom");
    assert.ok(zoomed > 1, "滚轮没有缩放三维视角");

    await evaluate(cdp, `(() => {
      const app = window.CubeLabApp;
      app.reset();
      app.scramble(20);
      app.setSpeed(0.2);
      app.solve();
      return true;
    })()`);
    await sleep(160);
    const slowProgress = await evaluate(cdp, "window.CubeLabApp.getState()");
    await evaluate(cdp, "window.CubeLabApp.setSpeed(2)");
    await sleep(160);
    const fastProgress = await evaluate(cdp, "window.CubeLabApp.getState()");
    assert.ok(fastProgress.activeProgress > slowProgress.activeProgress, "变速没有立即影响当前转动");
    await evaluate(cdp, "window.CubeLabApp.setSpeed(3)");
    let finalState = null;
    const finalDeadline = Date.now() + 18000;
    while (Date.now() < finalDeadline) {
      finalState = await evaluate(cdp, "window.CubeLabApp.getState()");
      if (finalState.solved) break;
      await sleep(400);
    }
    assert.equal(finalState.solved, true, "完整播放后魔方没有还原");
    const finalLabels = await evaluate(cdp, `(() => ({
      header: document.querySelector('#headerStatus').textContent,
      sealClass: document.querySelector('#solvedSeal').className,
      counter: document.querySelector('#stepCounter').textContent,
    }))()`);
    assert.equal(finalLabels.header, "已还原");
    assert.equal(finalLabels.sealClass.includes("is-hidden"), false);
    await screenshot(cdp, "06-complete-1440x900.png");

    const violations = cdp.events.filter((event) =>
      event.method === "Runtime.exceptionThrown" ||
      (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") ||
      (event.method === "Log.entryAdded" && event.params.entry.level === "error"));
    for (const event of violations) {
      consoleErrors.push(JSON.stringify(event.params));
    }
    for (const event of cdp.events.filter((item) => item.method === "Network.loadingFailed")) {
      failedRequests.push(event.params.errorText);
    }
    for (const event of cdp.events.filter((item) => item.method === "Network.requestWillBeSent")) {
      const url = event.params.request.url;
      if (!url.startsWith("file:") && !url.startsWith("data:") && !url.startsWith("blob:")) {
        externalRequests.push(url);
      }
    }
    assert.deepEqual(consoleErrors, [], `控制台错误：${consoleErrors.join("\\n")}`);
    assert.deepEqual(failedRequests, [], `资源请求失败：${failedRequests.join("\\n")}`);
    assert.deepEqual(externalRequests, [], `出现外部请求：${externalRequests.join("\\n")}`);

    process.stdout.write(`浏览器检查通过。截图目录：${outputDir}\n`);
  } finally {
    if (cdp) cdp.close();
    browser.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\\n`);
  process.exitCode = 1;
});
