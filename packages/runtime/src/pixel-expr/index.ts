// Pixel-Expr — author per-pixel shading in the Expr language, compiled to
// GLSL ES 3.0 + WGSL (SHADER-EXTENSION-PLAN.md, Tier B).
export { compilePixelExpr, buildGlslFragment, buildWgslFragment } from './compile.js';
export type { PxType, PixelExprResult, PixelExprOk, PixelExprErr } from './compile.js';
