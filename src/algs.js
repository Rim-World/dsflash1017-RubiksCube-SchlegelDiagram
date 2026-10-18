(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CubeLab = root.CubeLab || {}).Algs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const METHODS = Object.freeze({
    CFOP: {
      code: "CFOP",
      subtitle: "CROSS / F2L / OLL / PLL",
      stages: [
        { name: "十字", color: "#c85643" },
        { name: "F2L", color: "#dfad45" },
        { name: "OLL", color: "#4d7c5d" },
        { name: "PLL", color: "#4b639c" },
      ],
    },
    ROUX: {
      code: "ROUX",
      subtitle: "ROUX / BLOCKS",
      stages: [
        { name: "FB", color: "#c85643" },
        { name: "SB", color: "#dfad45" },
        { name: "CMLL", color: "#4d7c5d" },
        { name: "LSE", color: "#4b639c" },
      ],
    },
  });

  const FORMULAS = Object.freeze({
    OLL: [
      "R U R' U R U2 R'",
      "R U2 R2 F R F' U2 R' F R F'",
      "F R U R' U' F'",
      "R U2 R2 U' R2 U' R2 U2 R",
      "r U R' U R U2 r'",
      "R2 D' R U2 R' D R U2 R",
    ],
    PLL: [
      "R U R' U' R' F R2 U' R' U' R U R' F'",
      "R U' R' U' R U R D R' U' R D' R' U2 R'",
      "R2 F2 R U2 R U2 R' F R U R' U' R' F R2",
      "R U' R' U' R U R' F' R U R' U' R' F R",
    ],
    CMLL: [
      "R U R' U R U2 R'",
      "R U2 R' U' R U' R'",
      "F R U R' U' F'",
      "R U R' F' R U R' U' R' F R2 U' R'",
    ],
    LSE: [
      "M' U2 M U2",
      "M U M' U2 M U M'",
      "M' U2 M U M' U2 M",
    ],
  });

  function formulaSet(method, stage) {
    return (FORMULAS[stage] || []).slice();
  }

  return { METHODS, FORMULAS, formulaSet };
});
