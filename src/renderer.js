(function (root, factory) {
  const deps = typeof module === "object" && module.exports
    ? { GL: require("./glutil.js"), Geo: require("./geometry.js"), CubeData: require("./cube.js") }
    : { GL: root.CubeLab.GLUtil, Geo: root.CubeLab.Geometry, CubeData: root.CubeLab.CubeData };
  const api = factory(deps.GL, deps.Geo, deps.CubeData);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).Renderer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GL, Geo, CubeData) {
  "use strict";

  const { multiply, translation, rotationAxis, scaling, perspective, lookAt, projectPoint } = GL;
  const { applyMatrix3 } = CubeData;

  const BACKGROUND_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

  const BACKGROUND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_resolution;
uniform vec3 u_paper;
uniform vec3 u_paperLight;
uniform vec3 u_ink;
uniform vec4 u_shadow;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sdRing(vec2 p, vec2 c, float r, float width) {
  return abs(length(p - c) - r) - width;
}
void main() {
  vec2 uv = v_uv;
  vec2 px = gl_FragCoord.xy;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 color = u_paper;
  vec2 lightP = vec2(0.18 * aspect, 0.88);
  float light = exp(-dot(p - lightP, p - lightP) * 2.6);
  color = mix(color, u_paperLight, light * 0.52);
  float wash = exp(-dot(p - vec2(0.95 * aspect, 0.86), p - vec2(0.95 * aspect, 0.86)) * 1.7);
  color = mix(color, vec3(0.95, 0.91, 0.83), wash * 0.13);
  vec2 gridPx = mod(px + vec2(0.5), vec2(24.0));
  float grid = smoothstep(0.48, 0.0, min(gridPx.x, gridPx.y));
  color = mix(color, u_ink, grid * 0.028);
  vec2 c1 = vec2(0.72 * aspect, 0.39);
  vec2 c2 = vec2(0.78 * aspect, 0.34);
  float ringA = 1.0 - smoothstep(0.0, 0.9, sdRing(p, c1, 0.235, 0.0008));
  float ringB = 1.0 - smoothstep(0.0, 0.9, sdRing(p, c2, 0.165, 0.0007));
  color = mix(color, u_ink, (ringA * 0.055 + ringB * 0.04));
  vec2 cross = abs(p - vec2(0.09 * aspect, 0.2));
  float crossMask = (1.0 - smoothstep(0.0008, 0.002, min(cross.x, cross.y)));
  color = mix(color, u_ink, crossMask * 0.12);
  for (int i = 0; i < 7; i++) {
    float y = 0.12 + float(i) * 0.016;
    float tick = (1.0 - smoothstep(0.0, 0.0012, abs(p.y - y))) *
      (1.0 - smoothstep(0.01, 0.03, abs(p.x - 0.09 * aspect)));
    color = mix(color, u_ink, tick * 0.16);
  }
  float grain = hash12(floor(px / 2.0));
  float fiber = sin((px.x + px.y * 0.47) * 2.2) * 0.0035;
  color += (grain - 0.5) * 0.014 + fiber;
  vec2 shadowDelta = (uv - u_shadow.xy) / max(u_shadow.zw, vec2(0.0001));
  float shadowDistance = length(shadowDelta);
  float contact = 1.0 - smoothstep(0.34, 0.92, shadowDistance);
  float contactHalo = 1.0 - smoothstep(0.62, 1.0, shadowDistance);
  color = mix(color, vec3(0.16, 0.15, 0.18), contact * 0.3 + contactHalo * 0.1);
  float vignette = smoothstep(0.82, 0.32, length(uv - 0.5));
  color = mix(color * 0.965, color, 0.72 + vignette * 0.28);
  outColor = vec4(color, 1.0);
}`;

  const BODY_VERT = `#version 300 es
precision highp float;
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec3 v_normal;
out vec3 v_world;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_world = world.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  gl_Position = u_projection * u_view * world;
}`;

  const BODY_FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_world;
uniform vec3 u_camera;
uniform vec3 u_plastic;
uniform vec3 u_ink;
out vec4 outColor;
void main() {
  vec3 n = normalize(v_normal);
  vec3 viewDir = normalize(u_camera - v_world);
  vec3 lightDir = normalize(vec3(-0.42, 0.84, 0.48));
  float diffuse = dot(n, lightDir) * 0.5 + 0.5;
  float darkEdge = 0.26;
  float lightEdge = 0.76;
  float shadeDark = smoothstep(darkEdge - 0.025, darkEdge + 0.025, diffuse);
  float shadeLight = smoothstep(lightEdge - 0.035, lightEdge + 0.035, diffuse);
  vec3 shadow = mix(u_plastic, vec3(0.62, 0.65, 0.76), 0.35);
  vec3 middle = mix(u_plastic, vec3(1.0, 0.98, 0.92), 0.18);
  vec3 bright = mix(middle, vec3(1.0, 0.985, 0.94), 0.54);
  vec3 color = mix(shadow, middle, shadeDark);
  color = mix(color, bright, shadeLight);
  float rim = pow(1.0 - max(0.0, dot(n, viewDir)), 2.4);
  color = mix(color, vec3(0.47, 0.55, 0.73), rim * 0.19);
  color = mix(color, u_ink, 0.035);
  outColor = vec4(color, 1.0);
}`;

  const OUTLINE_VERT = `#version 300 es
precision highp float;
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform vec2 u_resolution;
uniform float u_linePixels;
out vec3 v_normal;
void main() {
  vec4 world = u_model * vec4(a_position * 1.012, 1.0);
  vec3 normalView = normalize(mat3(u_view * u_model) * a_normal);
  vec4 clip = u_projection * u_view * world;
  vec2 direction = normalView.xy;
  float lengthDirection = length(direction);
  direction = lengthDirection > 0.0001 ? direction / lengthDirection : vec2(0.0);
  clip.xy += direction * (u_linePixels / u_resolution) * clip.w * 2.0;
  gl_Position = clip;
  v_normal = normalView;
}`;

  const OUTLINE_FRAG = `#version 300 es
precision highp float;
uniform vec3 u_ink;
out vec4 outColor;
void main() {
  outColor = vec4(u_ink, 1.0);
}`;

  const STICKER_VERT = `#version 300 es
precision highp float;
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_world;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_uv = a_uv;
  v_normal = normalize(mat3(u_model) * a_normal);
  v_world = world.xyz;
  gl_Position = u_projection * u_view * world;
}`;

  const STICKER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_world;
uniform vec3 u_color;
uniform vec3 u_camera;
uniform vec3 u_ink;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  float dist = roundedBox(v_uv, vec2(0.5), 0.115);
  float aa = max(fwidth(dist), 0.001);
  float mask = 1.0 - smoothstep(-aa, aa, dist);
  if (mask < 0.02) discard;
  vec3 n = normalize(v_normal);
  vec3 viewDir = normalize(u_camera - v_world);
  vec3 lightDir = normalize(vec3(-0.42, 0.84, 0.48));
  float lambert = dot(n, lightDir) * 0.5 + 0.5;
  float faceBand = mix(0.965, 1.028, smoothstep(0.35, 0.72, lambert));
  vec3 fill = u_color * faceBand;
  float edge = smoothstep(-0.095, -0.045, dist);
  fill = mix(fill, mix(fill, u_ink, 0.82), edge);
  float bevelGlow = 1.0 - smoothstep(0.0, 0.045, abs(dist + 0.115));
  fill += vec3(0.12, 0.10, 0.07) * bevelGlow * 0.33;
  vec2 px = gl_FragCoord.xy;
  float grain = hash12(floor(px / 3.0));
  float fiber = sin((px.x * 0.63 + px.y * 0.41) * 2.45) * 0.008;
  grain = (grain - 0.5) * 0.085 + fiber;
  float microLight = exp(-dot(v_uv - vec2(-0.28, 0.32), v_uv - vec2(-0.28, 0.32)) * 8.0);
  fill *= 1.0 + grain + microLight * 0.025;
  float rim = pow(1.0 - max(0.0, dot(n, viewDir)), 3.0);
  fill = mix(fill, vec3(0.62, 0.67, 0.78), rim * 0.055);
  outColor = vec4(fill, mask);
}`;

  const SHADOW_VERT = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;

  const SHADOW_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_ink;
out vec4 outColor;
void main() {
  vec2 p = (v_uv - 0.5) * 2.0;
  float ellipse = length(p * vec2(1.0, 1.0));
  float core = 1.0 - smoothstep(0.48, 1.0, ellipse);
  float halo = 1.0 - smoothstep(0.82, 1.0, ellipse);
  float alpha = core * 0.5 + halo * 0.22;
  outColor = vec4(u_ink, alpha);
}`;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "着色器编译失败";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource, attributes) {
    const program = gl.createProgram();
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    for (const attribute of attributes) gl.bindAttribLocation(program, attribute.location, attribute.name);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "着色器链接失败");
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  function buffer(gl, target, data) {
    const result = gl.createBuffer();
    gl.bindBuffer(target, result);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return result;
  }

  function mat4FromMatrix3(matrix) {
    return new Float32Array([
      matrix[0], matrix[3], matrix[6], 0,
      matrix[1], matrix[4], matrix[7], 0,
      matrix[2], matrix[5], matrix[8], 0,
      0, 0, 0, 1,
    ]);
  }

  function faceOrientation(localNormal) {
    if (localNormal[2] === 1) return GL.identity();
    if (localNormal[2] === -1) return rotationAxis("y", Math.PI);
    if (localNormal[0] === 1) return rotationAxis("y", Math.PI / 2);
    if (localNormal[0] === -1) return rotationAxis("y", -Math.PI / 2);
    if (localNormal[1] === 1) return rotationAxis("x", -Math.PI / 2);
    return rotationAxis("x", Math.PI / 2);
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }

  class CubeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", {
        antialias: true,
        alpha: false,
        premultipliedAlpha: false,
        powerPreference: "high-performance",
      });
      if (!this.gl) throw new Error("当前浏览器无法创建 WebGL 2 画布。");
      this.dpr = 1;
      this.cssWidth = 1;
      this.cssHeight = 1;
      this.yaw = 0.62;
      this.pitch = 0.4;
      this.userZoom = 1;
      this.velocityYaw = 0;
      this.velocityPitch = 0;
      this.cameraDistance = 8;
      this.cameraPosition = [0, 0, 8];
      this.lastFrameTime = performance.now();
      this.createResources();
      this.resize(window.devicePixelRatio || 1);
    }

    createResources() {
      const gl = this.gl;
      this.programs = {
        background: createProgram(gl, BACKGROUND_VERT, BACKGROUND_FRAG, [
          { location: 0, name: "a_position" },
        ]),
        body: createProgram(gl, BODY_VERT, BODY_FRAG, [
          { location: 0, name: "a_position" },
          { location: 1, name: "a_normal" },
        ]),
        outline: createProgram(gl, OUTLINE_VERT, OUTLINE_FRAG, [
          { location: 0, name: "a_position" },
          { location: 1, name: "a_normal" },
        ]),
        sticker: createProgram(gl, STICKER_VERT, STICKER_FRAG, [
          { location: 0, name: "a_position" },
          { location: 1, name: "a_normal" },
          { location: 2, name: "a_uv" },
        ]),
        shadow: createProgram(gl, SHADOW_VERT, SHADOW_FRAG, [
          { location: 0, name: "a_position" },
          { location: 2, name: "a_uv" },
        ]),
      };

      const box = Geo.createRoundedBox(0.46, 0.07, 10);
      this.boxVao = gl.createVertexArray();
      gl.bindVertexArray(this.boxVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, box.positions));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, box.normals));
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      this.boxIb = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, box.indices);
      this.boxCount = box.count;

      const sticker = Geo.createStickerQuad(0.79);
      this.stickerVao = gl.createVertexArray();
      gl.bindVertexArray(this.stickerVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, sticker.positions));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, sticker.normals));
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, sticker.uvs));
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      this.stickerIb = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, sticker.indices);
      this.stickerCount = sticker.count;

      const plane = Geo.createPlane();
      this.shadowVao = gl.createVertexArray();
      gl.bindVertexArray(this.shadowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, plane.positions));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, plane.uvs));
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      this.shadowIb = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, plane.indices);
      this.shadowCount = plane.count;

      const bg = Geo.createFullscreenTriangle();
      this.bgVao = gl.createVertexArray();
      gl.bindVertexArray(this.bgVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl, gl.ARRAY_BUFFER, bg.positions));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.bgCount = bg.count;
      gl.bindVertexArray(null);
    }

    resize(dpr = window.devicePixelRatio || 1) {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const effectiveDpr = Math.max(1, dpr);
      const pixelWidth = Math.round(width * effectiveDpr);
      const pixelHeight = Math.round(height * effectiveDpr);
      const changed =
        this.canvas.width !== pixelWidth ||
        this.canvas.height !== pixelHeight ||
        Math.abs(width - this.cssWidth) > 0.1 ||
        Math.abs(height - this.cssHeight) > 0.1;
      if (changed) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
        this.cssWidth = width;
        this.cssHeight = height;
        this.dpr = effectiveDpr;
        this.computeCameraFit();
      } else {
        this.dpr = effectiveDpr;
      }
      return changed;
    }

    computeCameraFit() {
      const aspect = this.cssWidth / Math.max(1, this.cssHeight);
      const fov = 33 * Math.PI / 180;
      const desiredWidthFraction = this.cssWidth < 520 ? 0.86 : 0.7;
      const maxHeightFraction = this.cssWidth < 520 ? 0.88 : 0.83;
      const target = [0, 0, 0];
      const direction = [
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      ];
      const corners = [];
      for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
        corners.push([x, y, z]);
      }
      let chosen = 8;
      for (let distance = 4.5; distance <= 30; distance += 0.1) {
        const eye = [
          target[0] + direction[0] * distance,
          target[1] + direction[1] * distance,
          target[2] + direction[2] * distance,
        ];
        const view = lookAt(eye, target, [0, 1, 0]);
        const projection = perspective(fov, aspect, 0.1, 80);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const corner of corners) {
          const point = projectPoint(multiply(projection, view), corner, this.cssWidth, this.cssHeight);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
        const widthFraction = (maxX - minX) / this.cssWidth;
        const heightFraction = (maxY - minY) / this.cssHeight;
        if (widthFraction <= desiredWidthFraction && heightFraction <= maxHeightFraction) {
          chosen = distance;
          break;
        }
      }
      this.fitDistance = chosen;
      this.cameraDistance = chosen / this.userZoom;
      this.cameraPosition = [
        direction[0] * this.cameraDistance,
        direction[1] * this.cameraDistance,
        direction[2] * this.cameraDistance,
      ];
      this.projection = perspective(fov, aspect, 0.1, 80);
      this.view = lookAt(this.cameraPosition, [0, 0, 0], [0, 1, 0]);
      this.cameraViewProjection = multiply(this.projection, this.view);
    }

    setCamera(yaw, pitch, userZoom) {
      this.yaw = yaw;
      this.pitch = Math.max(-1.2, Math.min(1.2, pitch));
      if (userZoom !== undefined) this.userZoom = Math.max(0.72, Math.min(1.12, userZoom));
      this.computeCameraFit();
    }

    orbit(deltaX, deltaY) {
      this.velocityYaw = -deltaX * 0.0052;
      this.velocityPitch = deltaY * 0.0044;
      this.yaw += this.velocityYaw;
      this.pitch = Math.max(-1.16, Math.min(1.18, this.pitch + this.velocityPitch));
      this.computeCameraFit();
    }

    updateInertia(deltaSeconds) {
      const damping = Math.pow(0.06, deltaSeconds);
      if (Math.abs(this.velocityYaw) + Math.abs(this.velocityPitch) < 0.00008) {
        this.velocityYaw = 0;
        this.velocityPitch = 0;
        return false;
      }
      this.yaw += this.velocityYaw;
      this.pitch = Math.max(-1.16, Math.min(1.18, this.pitch + this.velocityPitch));
      this.velocityYaw *= damping;
      this.velocityPitch *= damping;
      this.computeCameraFit();
      return true;
    }

    resetCamera() {
      this.yaw = 0.62;
      this.pitch = 0.4;
      this.userZoom = 1;
      this.velocityYaw = 0;
      this.velocityPitch = 0;
      this.computeCameraFit();
    }

    cubieModel(cubie, turn) {
      const base = multiply(
        translation(cubie.position[0], cubie.position[1], cubie.position[2]),
        mat4FromMatrix3(cubie.orientation),
      );
      if (!turn || !turn.layers.includes(cubie.position[["x", "y", "z"].indexOf(turn.axis)])) {
        return base;
      }
      const pre = rotationAxis(turn.axis, turn.angleRadians);
      return multiply(pre, base);
    }

    stickerQuads(cube, turn) {
      const quads = [];
      for (const cubie of cube.cubies) {
        const orientation = mat4FromMatrix3(cubie.orientation);
        const affected = turn && turn.layers.includes(
          cubie.position[["x", "y", "z"].indexOf(turn.axis)],
        );
        const pre = affected ? rotationAxis(turn.axis, turn.angleRadians) : null;
        for (const sticker of cubie.stickers) {
          const normal = applyMatrix3(cubie.orientation, sticker.local);
          let model = multiply(
            multiply(
              translation(cubie.position[0], cubie.position[1], cubie.position[2]),
              orientation,
            ),
            multiply(
              translation(
                sticker.local[0] * 0.466,
                sticker.local[1] * 0.466,
                sticker.local[2] * 0.466,
              ),
              faceOrientation(sticker.local),
            ),
          );
          if (pre) model = multiply(pre, model);
          let normalWorld = normal.slice();
          let center = [
            cubie.position[0] + normal[0] * 0.471,
            cubie.position[1] + normal[1] * 0.471,
            cubie.position[2] + normal[2] * 0.471,
          ];
          if (pre) {
            const point = GL.transformPoint(pre, center);
            center = [point[0], point[1], point[2]];
            const n = GL.transformPoint(pre, [...normal, 0]);
            normalWorld = [n[0], n[1], n[2]];
          }
          const cornerWorld = [];
          for (const localCorner of [
            [-0.395, -0.395, 0],
            [0.395, -0.395, 0],
            [0.395, 0.395, 0],
            [-0.395, 0.395, 0],
          ]) {
            const point = GL.transformPoint(model, localCorner);
            cornerWorld.push([point[0], point[1], point[2]]);
          }
          const cornersScreen = cornerWorld.map((point) =>
            projectPoint(this.cameraViewProjection, point, this.cssWidth, this.cssHeight));
          const centerScreen = projectPoint(
            this.cameraViewProjection,
            center,
            this.cssWidth,
            this.cssHeight,
          );
          quads.push({
            sticker,
            cubie,
            normal: normalWorld,
            center,
            model,
            centerScreen,
            cornersScreen,
          });
        }
      }
      return quads;
    }

    hitTestSticker(cube, screenX, screenY) {
      const quads = this.stickerQuads(cube);
      const pointInTriangle = (point, a, b, c) => {
        const d1 = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        const d2 = (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x);
        const d3 = (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x);
        const hasNegative = d1 < -0.01 || d2 < -0.01 || d3 < -0.01;
        const hasPositive = d1 > 0.01 || d2 > 0.01 || d3 > 0.01;
        return !(hasNegative && hasPositive);
      };
      let best = null;
      for (const quad of quads) {
        const toCamera = GL.normalize(GL.subtract(this.cameraPosition, quad.center));
        if (GL.dot(quad.normal, toCamera) < 0.03) continue;
        const corners = quad.cornersScreen;
        if (corners.some((corner) => !corner)) continue;
        const point = { x: screenX, y: screenY };
        const inside =
          pointInTriangle(point, corners[0], corners[1], corners[2]) ||
          pointInTriangle(point, corners[0], corners[2], corners[3]);
        if (!inside) continue;
        if (!best || quad.centerScreen.z < best.centerScreen.z) best = quad;
      }
      return best;
    }

    draw(cube, turn = null) {
      const gl = this.gl;
      const width = this.canvas.width;
      const height = this.canvas.height;
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clearColor(0.945, 0.914, 0.855, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const bg = this.programs.background;
      gl.useProgram(bg.program);
      gl.uniform2f(bg.uniforms.u_resolution, this.cssWidth, this.cssHeight);
      gl.uniform3fv(bg.uniforms.u_paper, hexToRgb("#f1e9da"));
      gl.uniform3fv(bg.uniforms.u_paperLight, hexToRgb("#fbf7ee"));
      gl.uniform3fv(bg.uniforms.u_ink, hexToRgb("#252229"));
      const projected = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
        const point = projectPoint(
          this.cameraViewProjection,
          [x, y, z],
          this.cssWidth,
          this.cssHeight,
        );
        projected.minX = Math.min(projected.minX, point.x);
        projected.maxX = Math.max(projected.maxX, point.x);
        projected.minY = Math.min(projected.minY, point.y);
        projected.maxY = Math.max(projected.maxY, point.y);
      }
      const shadowCenterX = (projected.minX + projected.maxX) / 2 / this.cssWidth;
      const shadowCenterY = 1 - (projected.maxY - this.cssHeight * 0.012) / this.cssHeight;
      const shadowRadiusX = (projected.maxX - projected.minX) * 0.47 / this.cssWidth;
      const shadowRadiusY = Math.max(7, (projected.maxY - projected.minY) * 0.045) / this.cssHeight;
      gl.uniform4f(
        bg.uniforms.u_shadow,
        shadowCenterX,
        shadowCenterY,
        shadowRadiusX,
        shadowRadiusY,
      );
      gl.bindVertexArray(this.bgVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.bgCount);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      const outline = this.programs.outline;
      gl.useProgram(outline.program);
      gl.uniformMatrix4fv(outline.uniforms.u_projection, false, this.projection);
      gl.uniformMatrix4fv(outline.uniforms.u_view, false, this.view);
      gl.uniform2f(outline.uniforms.u_resolution, this.cssWidth, this.cssHeight);
      gl.uniform1f(outline.uniforms.u_linePixels, 1.45);
      gl.uniform3fv(outline.uniforms.u_ink, hexToRgb("#24222b"));
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.bindVertexArray(this.boxVao);
      for (const cubie of cube.cubies) {
        const model = this.cubieModel(cubie, turn);
        gl.uniformMatrix4fv(outline.uniforms.u_model, false, model);
        gl.drawElements(gl.TRIANGLES, this.boxCount, gl.UNSIGNED_SHORT, 0);
      }

      const body = this.programs.body;
      gl.useProgram(body.program);
      gl.uniformMatrix4fv(body.uniforms.u_projection, false, this.projection);
      gl.uniformMatrix4fv(body.uniforms.u_view, false, this.view);
      gl.uniform3fv(body.uniforms.u_camera, this.cameraPosition);
      gl.uniform3fv(body.uniforms.u_plastic, hexToRgb("#efe8da"));
      gl.uniform3fv(body.uniforms.u_ink, hexToRgb("#24222b"));
      gl.cullFace(gl.BACK);
      for (const cubie of cube.cubies) {
        const model = this.cubieModel(cubie, turn);
        gl.uniformMatrix4fv(body.uniforms.u_model, false, model);
        gl.drawElements(gl.TRIANGLES, this.boxCount, gl.UNSIGNED_SHORT, 0);
      }
      gl.disable(gl.CULL_FACE);

      const stickerProgram = this.programs.sticker;
      gl.useProgram(stickerProgram.program);
      gl.uniformMatrix4fv(stickerProgram.uniforms.u_projection, false, this.projection);
      gl.uniformMatrix4fv(stickerProgram.uniforms.u_view, false, this.view);
      gl.uniform3fv(stickerProgram.uniforms.u_camera, this.cameraPosition);
      gl.uniform3fv(stickerProgram.uniforms.u_ink, hexToRgb("#24222b"));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.bindVertexArray(this.stickerVao);
      const quads = this.stickerQuads(cube, turn);
      for (const quad of quads) {
        const toCamera = GL.normalize(GL.subtract(this.cameraPosition, quad.center));
        if (GL.dot(quad.normal, toCamera) <= 0.015) continue;
        gl.uniformMatrix4fv(stickerProgram.uniforms.u_model, false, quad.model);
        gl.uniform3fv(stickerProgram.uniforms.u_color, hexToRgb(quad.sticker.color));
        gl.drawElements(gl.TRIANGLES, this.stickerCount, gl.UNSIGNED_SHORT, 0);
      }
      gl.bindVertexArray(null);
    }

    getMetrics() {
      const bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      const corners = [];
      for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
        corners.push([x, y, z]);
      }
      for (const corner of corners) {
        const point = projectPoint(this.cameraViewProjection, corner, this.cssWidth, this.cssHeight);
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxY = Math.max(bounds.maxY, point.y);
      }
      return {
        cssWidth: this.cssWidth,
        cssHeight: this.cssHeight,
        pixelWidth: this.canvas.width,
        pixelHeight: this.canvas.height,
        dpr: this.dpr,
        bboxWidthFraction: (bounds.maxX - bounds.minX) / this.cssWidth,
        bboxHeightFraction: (bounds.maxY - bounds.minY) / this.cssHeight,
        yaw: this.yaw,
        pitch: this.pitch,
        zoom: this.userZoom,
      };
    }

    sampleFrame(cube) {
      this.draw(cube);
      const gl = this.gl;
      const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
      gl.readPixels(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      let nonPaper = 0;
      let samples = 0;
      const colors = new Set();
      const step = Math.max(1, Math.floor(Math.sqrt(pixels.length / 4 / 9000)));
      for (let y = 0; y < this.canvas.height; y += step) {
        for (let x = 0; x < this.canvas.width; x += step) {
          const index = (y * this.canvas.width + x) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          samples += 1;
          colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
          if (Math.abs(r - 241) + Math.abs(g - 233) + Math.abs(b - 218) > 36) nonPaper += 1;
        }
      }
      return {
        width: this.canvas.width,
        height: this.canvas.height,
        samples,
        uniqueColors: colors.size,
        nonPaperRatio: samples ? nonPaper / samples : 0,
      };
    }
  }

  return {
    CubeRenderer,
    compileShader,
    createProgram,
  };
});
