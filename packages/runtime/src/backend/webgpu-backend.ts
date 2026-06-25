// WebGPU implementation of the Backend interface.
//
// Design choices made explicitly to avoid every v0 bug class:
//   - Corner radius is normalized (0..0.5) at the interface boundary, not pixels.
//   - Shape type is encoded as f32 (0.0 / 1.0), compared with > 0.5 in the shader.
//     Avoids the v0 u32-vs-f32 buffer-write mismatch.
//   - Premultiplied alpha throughout: textures uploaded with `premultipliedAlpha: true`,
//     shaders assume premultiplied input, swap chain configured for premultiplied output.
//   - Per-draw uniform buffer via `mappedAtCreation: true` — single allocation per
//     draw call, no queue.writeBuffer overhead, no per-frame buffer pool to maintain.
//   - Single shared vertex buffer (unit quad with default UVs). UV sub-rect is
//     passed as a uniform and applied in the vertex shader. No per-character
//     vertex buffer creation (the v0 pattern that may have caused the text bug).
//   - All shaders inline here. <200 lines of WGSL total; splitting across files
//     adds indirection without payoff at this size.

import type { RGBA } from '../compositor/color.js';
import { composeQuadTransform, homographyToPhysical, invertHomography, projectPixelMatrix } from '../compositor/transform.js';
import { getLogger } from '../logger.js';
import { STYLIZE_MODE_INDEX } from './backend.js';
import type {
  Backend,
  BackendCapabilities,
  BackdropBlendDrawParams,
  BlendMode,
  FilteredQuadDrawParams,
  GlassQuadDrawParams,
  MaskedQuadDrawParams,
  RenderTarget,
  StylizedQuadDrawParams,
  ShapeDrawParams,
  LitParams,
  ShapeShadowDrawParams,
  Texture,
  TextureSource,
  TexturedQuadDrawParams,
} from './backend.js';

interface WebGPUTexture extends Texture {
  readonly gpuTexture: GPUTexture;
  readonly view: GPUTextureView;
}

// ─── Shaders ────────────────────────────────────────────────────────────────

// Shape pipeline: solid-color rectangles + ellipses + rounded rectangles,
// with optional shader-level stroke. The stroke band is painted directly
// from the SDF — no compositing through the fill — so it stays clean
// against semi-transparent fills.
// Shadow pipeline: see SHADOW_FS in webgl-backend.ts for the algorithm.
// Quad is sized to (shape + 2*blur). The SDF computes distance to the
// inner shape; alpha = 1 - smoothstep(0, blur, dist), so the shadow
// reaches full opacity at the shape edge and fades over `blur` pixels.
const SHADOW_SHADER = /* wgsl */ `
struct ShadowUniforms {
  transform: mat4x4<f32>,    // 64 bytes, offset 0
  color: vec4<f32>,          // 16 bytes, offset 64   — shadow color, premultiplied
  cornerRadius: f32,         // 4 bytes,  offset 80
  shapeType: f32,            // 4 bytes,  offset 84
  blur: f32,                 // 4 bytes,  offset 88
  _pad0: f32,                // 4 bytes,  offset 92   — std140 alignment
  size: vec2<f32>,           // 8 bytes,  offset 96   — shape size
  quadSize: vec2<f32>,       // 8 bytes,  offset 104  — rendered-quad size
  _pad1: vec4<f32>,          // 16 bytes, offset 112  — pad to 128
}
@group(0) @binding(0) var<uniform> u: ShadowUniforms;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let p = in.uv * u.quadSize;
  let shapeHalf = u.size * 0.5;
  let quadHalf = u.quadSize * 0.5;
  let ps = p - quadHalf + shapeHalf;
  var dist: f32;
  if (u.shapeType > 0.5) {
    let d = (ps - shapeHalf) / shapeHalf;
    dist = (sqrt(dot(d, d)) - 1.0) * min(shapeHalf.x, shapeHalf.y);
  } else {
    let r = u.cornerRadius;
    let q = abs(ps - shapeHalf) - shapeHalf + vec2<f32>(r, r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
  }
  if (dist > u.blur) { discard; }
  // Symmetric falloff around the shape edge — matches CSS box-shadow's
  // Gaussian-blur erfc shape closely enough: alpha ~1.0 deep inside,
  // ~0.5 at the edge, ~0 at +blur past the edge.
  let alpha = 1.0 - smoothstep(-u.blur, u.blur, dist);
  if (alpha < 0.001) { discard; }
  return u.color * alpha;
}
`;

const SHAPE_SHADER = /* wgsl */ `
struct ShapeUniforms {
  transform: mat4x4<f32>,    // 64 bytes, offset 0
  color: vec4<f32>,          // 16 bytes, offset 64   — fill, premultiplied
  strokeColor: vec4<f32>,    // 16 bytes, offset 80   — stroke, premultiplied
  cornerRadius: f32,         // 4 bytes,  offset 96   — PIXELS
  shapeType: f32,            // 4 bytes,  offset 100  — 0.0 = rect, 1.0 = ellipse
  size: vec2<f32>,           // 8 bytes,  offset 104  — pixel (width, height)
  strokeWidth: f32,          // 4 bytes,  offset 112  — PIXELS; 0 disables
  _pad: f32,                 // 4 bytes,  offset 116  — std140 alignment pad
}                            // total: 120 bytes (round to 128 for uniform alignment)
@group(0) @binding(0) var<uniform> u: ShapeUniforms;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let p = in.uv * u.size;
  let half = u.size * 0.5;
  var dist: f32;
  if (u.shapeType > 0.5) {
    // Ellipse — approximate signed pixel distance via normalized space.
    let d = (p - half) / half;
    dist = (sqrt(dot(d, d)) - 1.0) * min(half.x, half.y);
  } else {
    // Rectangle / rounded rectangle SDF. r = 0 collapses to sharp rect.
    let r = u.cornerRadius;
    let q = abs(p - half) - half + vec2<f32>(r, r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
  }
  // Anti-aliased boundary via screen-space derivative — same approach
  // as the WebGL backend. Band width = 2 × fwidth(dist) for visibly
  // smooth edges even when the canvas is downsampled to a smaller
  // preview.
  let aa = fwidth(dist);
  let outerAlpha = 1.0 - smoothstep(-aa, aa, dist);
  if (outerAlpha < 0.001) { discard; }

  var base: vec4<f32>;
  if (u.strokeWidth > 0.0) {
    // strokeAlpha = 0 in the fill interior, 1 in the stroke band.
    let strokeAlpha = smoothstep(-u.strokeWidth - aa, -u.strokeWidth + aa, dist);
    base = mix(u.color, u.strokeColor, strokeAlpha);
  } else {
    base = u.color;
  }
  return base * outerAlpha;
}
`;

// Lit pipeline (§4.8): PBR direct-light shading for a shape. Lambert
// diffuse + GGX/Cook-Torrance specular + Schlick Fresnel, evaluated in
// WORLD space (the camera-free worldMatrix) so the specular hot-spot is
// view-dependent and sweeps as the camera moves. Must match the WebGL
// LIT_SHAPE_FS byte-for-byte in math — preview and export differ by
// backend. Output is premultiplied.
// Shared lit uniform block (§4.8). Reused by BOTH the lit-shape and
// lit-textured shaders. The lit-textured path reinterprets a few leading
// slots (see drawLitTexturedQuad): `albedo`→premultiplied tint,
// `strokeAlbedo`→uvRect, `params0.x`→cornerRadius. The PBR fields
// (normal..envAvg) are identical, which lets PBR_WGSL be shared verbatim.
const LIT_UNIFORMS_WGSL = /* wgsl */ `
struct LitUniforms {
  transform: mat4x4<f32>,            // offset 0    — clip-space projection
  worldMatrix: mat4x4<f32>,          // offset 64   — unit quad → world (camera-free)
  albedo: vec4<f32>,                 // offset 128  — shape: straight albedo | textured: premul tint
  strokeAlbedo: vec4<f32>,           // offset 144  — shape: straight stroke | textured: uvRect
  normal: vec4<f32>,                 // offset 160  — world face normal (xyz)
  eye: vec4<f32>,                    // offset 176  — world eye position (xyz)
  ambient: vec4<f32>,                // offset 192  — summed ambient color (xyz)
  params0: vec4<f32>,                // offset 208  — (cornerRadius, shapeType, strokeWidth, numLights)
  params1: vec4<f32>,                // offset 224  — (roughness, metalness, reflectivity, emissive)
  size: vec4<f32>,                   // offset 240  — (width_px, height_px, _, _)
  lightDir: array<vec4<f32>, 4>,     // offset 256  — world light directions (xyz)
  lightColor: array<vec4<f32>, 4>,   // offset 320  — light color × intensity (xyz)
  envColor: array<vec4<f32>, 4>,     // offset 384  — environment gradient stops (xyz)
  envParams: vec4<f32>,              // offset 448  — (stopCount, normalScale, hasNormalMap, _)
  envOffsets: vec4<f32>,             // offset 464  — up to 4 stop offsets
  envAvg: vec4<f32>,                 // offset 480  — mean env color (xyz)
  tangent: vec4<f32>,                // offset 496  — world +U for normal mapping (xyz)
  bitangent: vec4<f32>,              // offset 512  — world +V (xyz)
}                                    // total: 528 bytes
@group(0) @binding(0) var<uniform> u: LitUniforms;
`;

// Shared PBR functions: helpers + shadePBR(albedo, N, V). Math-identical
// to the WebGL PBR_FS_LIB. References the module-scope `u` from
// LIT_UNIFORMS_WGSL, so it must be concatenated AFTER it.
const PBR_WGSL = /* wgsl */ `
const PI = 3.14159265;
fn ggxD(NdotH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
fn gSchlick(x: f32, k: f32) -> f32 { return x / (x * (1.0 - k) + k); }
fn sampleEnv(t: f32, count: i32) -> vec3<f32> {
  var c = u.envColor[0].xyz;
  if (count > 1) {
    var last = u.envColor[1].xyz;
    if (count > 2) { last = u.envColor[2].xyz; }
    if (count > 3) { last = u.envColor[3].xyz; }
    let o0 = u.envOffsets.x; let o1 = u.envOffsets.y; let o2 = u.envOffsets.z; let o3 = u.envOffsets.w;
    if (t <= o1) {
      c = mix(u.envColor[0].xyz, u.envColor[1].xyz, clamp((t - o0) / max(o1 - o0, 1e-4), 0.0, 1.0));
    } else if (count > 2 && t <= o2) {
      c = mix(u.envColor[1].xyz, u.envColor[2].xyz, clamp((t - o1) / max(o2 - o1, 1e-4), 0.0, 1.0));
    } else if (count > 3 && t <= o3) {
      c = mix(u.envColor[2].xyz, u.envColor[3].xyz, clamp((t - o2) / max(o3 - o2, 1e-4), 0.0, 1.0));
    } else {
      c = last;
    }
  }
  return c;
}
// Shade a fragment given its straight albedo, world normal, view vector.
fn shadePBR(albedo: vec3<f32>, Nin: vec3<f32>, V: vec3<f32>) -> vec3<f32> {
  var N = Nin;
  if (dot(N, V) < 0.0) { N = -N; }       // two-sided
  let NdotV = max(dot(N, V), 1e-4);
  let rough = u.params1.x;
  let metal = u.params1.y;
  let F0 = mix(vec3<f32>(0.04), albedo, metal);
  let a = rough * rough;
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let numLights = i32(u.params0.w);

  var color = albedo * u.ambient.xyz;    // ambient (flat fill) term
  for (var i: i32 = 0; i < 4; i = i + 1) {
    if (i >= numLights) { break; }
    let L = normalize(u.lightDir[i].xyz);
    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);
    let F = F0 + (vec3<f32>(1.0) - F0) * pow(1.0 - VdotH, 5.0);
    let D = ggxD(NdotH, a);
    let G = gSchlick(NdotL, k) * gSchlick(NdotV, k);
    let spec = (D * G) * F / max(4.0 * NdotL * NdotV, 1e-3);
    let kd = (vec3<f32>(1.0) - F) * (1.0 - metal);
    color = color + (kd * albedo + spec) * u.lightColor[i].xyz * NdotL;
  }
  let envCount = i32(u.envParams.x);
  let envIsImage = u.envParams.w > 0.5;
  if (envCount > 0 || envIsImage) {
    let R = reflect(-V, N);
    var sharp: vec3<f32>;
    if (envIsImage) {
      // Equirect (lat-long) sample along the reflection ray. Up = −y.
      let Rn = normalize(R);
      let euv = vec2<f32>(atan2(Rn.x, Rn.z) / (2.0 * PI) + 0.5, acos(clamp(-Rn.y, -1.0, 1.0)) / PI);
      sharp = textureSampleLevel(envTex, samp, euv, 0.0).rgb;
    } else {
      let t = clamp(0.5 - 0.5 * (R.y / max(length(R), 1e-4)), 0.0, 1.0); // up→1, down→0
      sharp = sampleEnv(t, envCount);
    }
    let envc = mix(sharp, u.envAvg.xyz, rough);
    let Fr = F0 + (max(vec3<f32>(1.0 - rough), F0) - F0) * pow(1.0 - NdotV, 5.0);
    let kdEnv = (vec3<f32>(1.0) - Fr) * (1.0 - metal);
    color = color + (kdEnv * albedo * u.envAvg.xyz + envc * Fr) * u.params1.z;
  }
  color = mix(color, albedo, clamp(u.params1.w, 0.0, 1.0));   // emissive
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`;

// Normal-map perturbation (§4.8 Phase 2). Texture + sampler are passed in
// so the same helper serves both lit shaders (their bindings differ).
// envParams.y = normalScale, envParams.z = hasNormalMap.
const NORMAL_PERTURB_WGSL = /* wgsl */ `
fn perturbNormal(N: vec3<f32>, uv: vec2<f32>, nmap: texture_2d<f32>, nsamp: sampler) -> vec3<f32> {
  if (u.envParams.z < 0.5) { return N; }
  let s = textureSample(nmap, nsamp, uv).rgb * 2.0 - 1.0;
  let sc = s.xy * u.envParams.y;
  return normalize(sc.x * normalize(u.tangent.xyz) + sc.y * normalize(u.bitangent.xyz) + s.z * N);
}
`;

const LIT_SHAPE_SHADER = /* wgsl */ LIT_UNIFORMS_WGSL + `
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var envTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) worldPos: vec3<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  let wp = u.worldMatrix * vec4<f32>(pos, 0.0, 1.0);
  out.worldPos = wp.xyz;
  return out;
}
` + PBR_WGSL + NORMAL_PERTURB_WGSL + `
@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let p = in.uv * u.size.xy;
  let half = u.size.xy * 0.5;
  let cornerRadius = u.params0.x;
  let shapeType = u.params0.y;
  let strokeWidth = u.params0.z;

  var dist: f32;
  if (shapeType > 0.5) {
    let d = (p - half) / half;
    dist = (sqrt(dot(d, d)) - 1.0) * min(half.x, half.y);
  } else {
    let r = cornerRadius;
    let q = abs(p - half) - half + vec2<f32>(r, r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
  }
  let aa = fwidth(dist);
  let outerAlpha = 1.0 - smoothstep(-aa, aa, dist);
  if (outerAlpha < 0.001) { discard; }

  var alb = u.albedo;
  if (strokeWidth > 0.0) {
    let sa = smoothstep(-strokeWidth - aa, -strokeWidth + aa, dist);
    alb = mix(u.albedo, u.strokeAlbedo, sa);
  }
  let N = perturbNormal(normalize(u.normal.xyz), in.uv, normalTex, samp);
  let color = shadePBR(alb.rgb, N, normalize(u.eye.xyz - in.worldPos));
  let outA = alb.a * outerAlpha;
  return vec4<f32>(color * outA, outA);  // premultiplied
}
`;

// Lit textured quad (§4.8): images, video, flattened group cards shaded
// as one surface. Albedo = the texture's own (straight) pixels.
const LIT_TEXTURED_SHADER = /* wgsl */ LIT_UNIFORMS_WGSL + `
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var envTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) quadPos: vec2<f32>,
  @location(2) worldPos: vec3<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = mix(u.strokeAlbedo.xy, u.strokeAlbedo.zw, uv);   // strokeAlbedo = uvRect
  out.quadPos = uv;
  let wp = u.worldMatrix * vec4<f32>(pos, 0.0, 1.0);
  out.worldPos = wp.xyz;
  return out;
}
` + PBR_WGSL + NORMAL_PERTURB_WGSL + `
@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let s = textureSample(tex, samp, in.uv);   // premultiplied
  let cov = s.a;
  var albedo = select(s.rgb, s.rgb / cov, cov > 0.0);   // straight albedo
  let tint = u.albedo;                                  // premultiplied tint
  let tintRgb = select(vec3<f32>(1.0), tint.rgb / tint.a, tint.a > 0.0);
  albedo = albedo * tintRgb;

  var maskAlpha = 1.0;
  let cornerRadius = u.params0.x;
  if (cornerRadius > 0.0) {
    let p = in.quadPos * u.size.xy;
    let half = u.size.xy * 0.5;
    let r = cornerRadius;
    let q = abs(p - half) - half + vec2<f32>(r, r);
    let dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
    let aa = fwidth(dist);
    maskAlpha = 1.0 - smoothstep(-aa, aa, dist);
    if (maskAlpha < 0.001) { discard; }
  }
  let N = perturbNormal(normalize(u.normal.xyz), in.quadPos, normalTex, samp);
  let color = shadePBR(albedo, N, normalize(u.eye.xyz - in.worldPos));
  let outA = cov * tint.a * maskAlpha;
  return vec4<f32>(color * outA, outA);  // premultiplied
}
`;

// Gradient pipeline: shape filled with a linear or radial gradient.
// Up to 4 stops. Linear is direction-based (cos, sin of angle); radial is
// distance-from-center based.
//
// Stops are declared as four individual vec4 fields and the offset lookup is
// fully unrolled. WGSL technically allows runtime indexing into arrays and
// vector swizzles, but Chrome's tint validator has been finicky about it in
// uniform contexts. Const-indexed access is unambiguously safe.
const GRADIENT_SHADER = /* wgsl */ `
struct GradientUniforms {
  transform: mat4x4<f32>,           // offset 0,   size 64
  flags: vec4<f32>,                  // offset 64,  size 16  — cornerRadius (PIXELS), shapeType, fillType, numStops ("meta" is a reserved WGSL keyword)
  params: vec4<f32>,                 // offset 80,  size 16  — linear:(cos,sin,_,_) | radial:(cx,cy,radius,_)
  size: vec4<f32>,                   // offset 96,  size 16  — (width_px, height_px, _, _)
  stop0: vec4<f32>,                  // offset 112, size 16
  stop1: vec4<f32>,                  // offset 128, size 16
  stop2: vec4<f32>,                  // offset 144, size 16
  stop3: vec4<f32>,                  // offset 160, size 16
  stopOffsets: vec4<f32>,            // offset 176, size 16
}                                    // total: 192 bytes
@group(0) @binding(0) var<uniform> u: GradientUniforms;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let cornerRadius = u.flags.x;
  let shapeType = u.flags.y;
  let fillType = u.flags.z;

  // Shape masking — SDF in PIXEL space so corners are circular even on
  // non-square rectangles. Gradient parameter t still runs in UV space.
  let pxSize = u.size.xy;
  let p = uv * pxSize;
  let half = pxSize * 0.5;

  if (shapeType > 0.5) {
    let d = (p - half) / half;
    if (dot(d, d) > 1.0) { discard; }
  } else if (cornerRadius > 0.0) {
    let r = cornerRadius;
    let q = abs(p - half) - (half - vec2<f32>(r, r));
    let outside = max(q, vec2<f32>(0.0, 0.0));
    if (length(outside) > r) { discard; }
  }

  // Compute gradient parameter t in [0, 1] (still in UV space — gradient
  // directions are expressed relative to the shape's normalized bounding box).
  var t: f32 = 0.0;
  if (fillType > 0.5) {
    let radius = max(u.params.z, 0.0001);
    t = clamp(distance(uv, u.params.xy) / radius, 0.0, 1.0);
  } else {
    let dir = u.params.xy;
    let centered = uv - vec2<f32>(0.5, 0.5);
    t = clamp(dot(centered, dir) + 0.5, 0.0, 1.0);
  }

  let off0 = u.stopOffsets.x;
  let off1 = u.stopOffsets.y;
  let off2 = u.stopOffsets.z;
  let off3 = u.stopOffsets.w;

  var color: vec4<f32>;
  if (t <= off1) {
    let denom = max(off1 - off0, 0.0001);
    let segT = clamp((t - off0) / denom, 0.0, 1.0);
    color = mix(u.stop0, u.stop1, segT);
  } else if (t <= off2) {
    let denom = max(off2 - off1, 0.0001);
    let segT = clamp((t - off1) / denom, 0.0, 1.0);
    color = mix(u.stop1, u.stop2, segT);
  } else if (t <= off3) {
    let denom = max(off3 - off2, 0.0001);
    let segT = clamp((t - off2) / denom, 0.0, 1.0);
    color = mix(u.stop2, u.stop3, segT);
  } else {
    color = u.stop3;
  }

  return color;
}
`;

// Textured-quad pipeline: images, video frames, text atlas glyphs.
const TEXTURED_SHADER = /* wgsl */ `
struct TexturedUniforms {
  transform: mat4x4<f32>,   // 64 bytes, offset 0
  uvRect: vec4<f32>,        // 16 bytes, offset 64  — (u0, v0, u1, v1)
  tint: vec4<f32>,          // 16 bytes, offset 80  — premultiplied
  cornerRadius: f32,        // 4 bytes,  offset 96
  alphaGamma: f32,          // 4 bytes,  offset 100 — coverage exponent; 1 = no-op
  size: vec2<f32>,          // 8 bytes,  offset 104 — pixel (w, h) of the quad
  _pad1: vec4<f32>,         // 16 bytes, offset 112 — pad to 128
}                           // total: 128 bytes (aligned to 16)
@group(0) @binding(0) var<uniform> u: TexturedUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) quadPos: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  // Remap default 0..1 UVs into the sub-rect specified by uvRect.
  out.uv = mix(u.uvRect.xy, u.uvRect.zw, uv);
  out.quadPos = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var sample = textureSample(tex, samp, in.uv);  // already premultiplied (texture upload set premultipliedAlpha: true)
  if (u.alphaGamma != 1.0) {
    // Reshape coverage: a' = a^g. Premultiplied, so scale the whole
    // sample by a^(g-1); the max() guard keeps g<1 finite at a=0.
    sample = sample * pow(max(sample.a, 1e-5), u.alphaGamma - 1.0);
  }
  var maskAlpha: f32 = 1.0;
  if (u.cornerRadius > 0.0) {
    // Rounded-rect SDF in quad-local pixel space (matches SHAPE_FS).
    let p = in.quadPos * u.size;
    let half = u.size * 0.5;
    let r = u.cornerRadius;
    let q = abs(p - half) - half + vec2<f32>(r, r);
    let dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
    let aa = fwidth(dist);
    maskAlpha = 1.0 - smoothstep(-aa, aa, dist);
    if (maskAlpha < 0.001) { discard; }
  }
  return sample * u.tint * maskAlpha;
}
`;

// Masked composite: content gated by a second texture's alpha or
// luminance. Both premultiplied; scaling the whole premultiplied
// content color by the mask factor is the correct premultiplied op.
const MASKED_SHADER = /* wgsl */ `
struct MaskedUniforms {
  transform: mat4x4<f32>,   // 64 bytes, offset 0
  tint: vec4<f32>,          // 16 bytes, offset 64 — premultiplied
  mode: f32,                // 4 bytes,  offset 80 — 0 alpha, 1 alpha-inv, 2 luma, 3 luma-inv
  _pad0: f32,
  _pad1: vec2<f32>,         // pad to 96
}
@group(0) @binding(0) var<uniform> u: MaskedUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var contentTex: texture_2d<f32>;
@group(0) @binding(3) var maskTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let c = textureSample(contentTex, samp, in.uv) * u.tint;
  let m = textureSample(maskTex, samp, in.uv);
  var f: f32;
  if (u.mode < 0.5) {
    f = m.a;
  } else if (u.mode < 1.5) {
    f = 1.0 - m.a;
  } else {
    let luma = dot(m.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    f = select(1.0 - luma, luma, u.mode < 2.5);
  }
  return c * f;
}
`;

// Filter composite: a layer texture drawn 1:1 with an optional separable
// Gaussian blur pass plus color ops. 25 taps spread over ±3σ; weights
// computed in-shader and normalized by their sum. Color ops run on
// STRAIGHT alpha (unpremultiply → brightness → contrast → saturation →
// re-premultiply). Must match the WebGL FILTERED_FS exactly — preview
// and export run different backends.
// Backdrop-blend composite (§4.5) — piecewise blend modes. Reads the
// isolated element layer + a backdrop snapshot (both premultiplied,
// surface-sized), runs the W3C separable composite, REPLACES the
// target (pipeline uses replace blend). Must match WebGL
// BACKDROP_BLEND_FS exactly. Shares the masked bind-group shape.
const BACKDROP_BLEND_SHADER = /* wgsl */ `
struct BBUniforms {
  transform: mat4x4<f32>,   // 64 bytes
  mode: f32,                // 0 overlay, 1 hard-light, 2 soft-light
  backdropFlipY: f32,
  _pad: vec2<f32>,          // pad to 80
}
@group(0) @binding(0) var<uniform> u: BBUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcTex: texture_2d<f32>;
@group(0) @binding(3) var backdropTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

fn blendCh(mode: f32, cb: f32, cs: f32) -> f32 {
  if (mode < 0.5) {            // overlay
    return select(1.0 - 2.0*(1.0-cb)*(1.0-cs), 2.0*cb*cs, cb <= 0.5);
  } else if (mode < 1.5) {     // hard-light = overlay(src, backdrop)
    return select(1.0 - 2.0*(1.0-cs)*(1.0-cb), 2.0*cs*cb, cs <= 0.5);
  } else {                     // soft-light (W3C)
    if (cs <= 0.5) {
      return cb - (1.0 - 2.0*cs) * cb * (1.0 - cb);
    }
    let d = select(sqrt(cb), ((16.0*cb - 12.0)*cb + 4.0)*cb, cb <= 0.25);
    return cb + (2.0*cs - 1.0) * (d - cb);
  }
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let s = textureSample(srcTex, samp, in.uv);
  let buv = vec2<f32>(in.uv.x, select(in.uv.y, 1.0 - in.uv.y, u.backdropFlipY > 0.5));
  let b = textureSample(backdropTex, samp, buv);
  let sa = s.a;
  let ba = b.a;
  let Cs = select(vec3<f32>(0.0), s.rgb / sa, sa > 0.0);
  let Cb = select(vec3<f32>(0.0), b.rgb / ba, ba > 0.0);
  let Bc = vec3<f32>(blendCh(u.mode, Cb.r, Cs.r), blendCh(u.mode, Cb.g, Cs.g), blendCh(u.mode, Cb.b, Cs.b));
  let co = sa*(1.0-ba)*Cs + sa*ba*Bc + (1.0-sa)*ba*Cb;  // premultiplied
  let ao = sa + ba*(1.0-sa);
  return vec4<f32>(co, ao);
}
`;

const FILTERED_SHADER = /* wgsl */ `
struct FilteredUniforms {
  transform: mat4x4<f32>,   // 64 bytes, offset 0
  tint: vec4<f32>,          // 16 bytes, offset 64 — premultiplied
  texel: vec2<f32>,         //  8 bytes, offset 80 — blur dir ÷ tex physical dims
  sigma: f32,               //  4 bytes, offset 88 — Gaussian σ in PHYSICAL px; 0 = off
  _pad0: f32,               //  4 bytes, offset 92
  colorOps: vec4<f32>,      // 16 bytes, offset 96 — (brightness, contrast, saturation, hue radians)
}                           // total: 112, buffer rounded to 128
@group(0) @binding(0) var<uniform> u: FilteredUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  var acc: vec4<f32>;
  if (u.sigma > 0.0) {
    acc = vec4<f32>(0.0);
    var wsum: f32 = 0.0;
    for (var i: i32 = -12; i <= 12; i++) {
      let d = f32(i) * u.sigma * 0.25;  // taps cover ±3σ
      let w = exp(-0.5 * d * d / (u.sigma * u.sigma));
      acc += textureSampleLevel(tex, samp, in.uv + u.texel * d, 0.0) * w;
      wsum += w;
    }
    acc /= wsum;
  } else {
    acc = textureSampleLevel(tex, samp, in.uv, 0.0);
  }
  let a = acc.a;
  var c = select(vec3<f32>(0.0), acc.rgb / a, a > 0.0);
  c *= u.colorOps.x;                                  // brightness
  c = (c - 0.5) * u.colorOps.y + 0.5;                 // contrast
  let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));  // Rec. 709 luma
  c = mix(vec3<f32>(l), c, u.colorOps.z);             // saturation
  if (u.colorOps.w != 0.0) {                          // hue rotate (SVG matrix)
    let hc = cos(u.colorOps.w);
    let hs = sin(u.colorOps.w);
    c = mat3x3<f32>(
      vec3<f32>(0.213 + 0.787*hc - 0.213*hs, 0.213 - 0.213*hc + 0.143*hs, 0.213 - 0.213*hc - 0.787*hs),
      vec3<f32>(0.715 - 0.715*hc - 0.715*hs, 0.715 + 0.285*hc + 0.140*hs, 0.715 - 0.715*hc + 0.715*hs),
      vec3<f32>(0.072 - 0.072*hc + 0.928*hs, 0.072 - 0.072*hc - 0.283*hs, 0.072 + 0.928*hc + 0.072*hs)
    ) * c;
  }
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(c * a, a) * u.tint;
}
`;

// Stylize composite: one effects-array pass (§4.7) — pixelate, dither,
// halftone, or ascii — drawn 1:1 like the filter composite. Color math
// runs on STRAIGHT alpha; dot/glyph "ink" scales BOTH color and alpha.
// Must match the WebGL STYLIZED_FS exactly.
const STYLIZED_SHADER = /* wgsl */ `
struct StylizedUniforms {
  transform: mat4x4<f32>,   // 64 bytes, offset 0
  tint: vec4<f32>,          // 16 bytes, offset 64 — premultiplied
  texSize: vec2<f32>,       //  8 bytes, offset 80 — layer PHYSICAL dims
  mode: f32,                //  4 bytes, offset 88 — 0 pixelate, 1 dither, 2 halftone, 3 ascii
  p0: f32,                  //  4 bytes, offset 92 — px params pre-scaled to PHYSICAL
  p1: f32,                  //  4 bytes, offset 96
  pixelRatio: f32,          // 100 — for resolution-independent dither cells
  _pad1: f32,               // 104
  _pad2: f32,               // 108 — struct size 112
}
@group(0) @binding(0) var<uniform> u: StylizedUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var aux: texture_2d<f32>;

const BAYER = array<f32, 16>(
   0.,  8.,  2., 10.,
  12.,  4., 14.,  6.,
   3., 11.,  1.,  9.,
  15.,  7., 13.,  5.);

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

fn straight(s: vec4<f32>) -> vec3<f32> {
  return select(vec3<f32>(0.0), s.rgb / s.a, s.a > 0.0);
}

// ── Normative noise (§4.7 fractal_noise / turbulent_displace) ──
// Must match the WebGL helpers exactly: PCG hash → value noise
// (quintic fade) → fBM (lacunarity 2, gain 0.5, per-octave seed+o).
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h01(c: vec3<i32>, seed: u32) -> f32 {
  return f32(pcg(bitcast<u32>(c.x) ^ pcg(bitcast<u32>(c.y) ^ pcg(bitcast<u32>(c.z) ^ pcg(seed))))) / 4294967295.0;
}
fn vnoise(p: vec3<f32>, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let uu = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let c = vec3<i32>(i);
  let n000 = h01(c, seed);
  let n100 = h01(c + vec3<i32>(1, 0, 0), seed);
  let n010 = h01(c + vec3<i32>(0, 1, 0), seed);
  let n110 = h01(c + vec3<i32>(1, 1, 0), seed);
  let n001 = h01(c + vec3<i32>(0, 0, 1), seed);
  let n101 = h01(c + vec3<i32>(1, 0, 1), seed);
  let n011 = h01(c + vec3<i32>(0, 1, 1), seed);
  let n111 = h01(c + vec3<i32>(1, 1, 1), seed);
  return mix(
    mix(mix(n000, n100, uu.x), mix(n010, n110, uu.x), uu.y),
    mix(mix(n001, n101, uu.x), mix(n011, n111, uu.x), uu.y), uu.z);
}
fn fbm(p0: vec3<f32>, octaves: i32, seed: u32) -> f32 {
  var p = p0;
  var v = 0.0;
  var amp = 1.0;
  var wsum = 0.0;
  for (var o = 0; o < 8; o++) {
    if (o >= octaves) { break; }
    v += amp * vnoise(p, seed + u32(o));
    wsum += amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return v / wsum;
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let px = in.uv * u.texSize;
  if (u.mode < 0.5) {
    // pixelate — every pixel takes its cell's center sample.
    let cell = max(u.p0, 1.0);
    let center = (floor(px / cell) + 0.5) * cell;
    return textureSampleLevel(tex, samp, center / u.texSize, 0.0) * u.tint;
  } else if (u.mode < 1.5) {
    // dither — per-channel quantize to N levels, 4×4 Bayer threshold.
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let a = s.a;
    var c = straight(s);
    // Bayer cells of u.p1 (pixel_size) LOGICAL px: divide device px by
    // (pixelRatio · pixel_size). Resolution-independent — stable across
    // preview DPI / export and survives the editor fit-to-stage downscale.
    let ip = vec2<i32>(px / max(u.pixelRatio * u.p1, 1.0));
    var bayer = BAYER; // const arrays can't be dynamically indexed
    let t = (bayer[(ip.y % 4) * 4 + (ip.x % 4)] + 0.5) / 16.0;
    let n = max(u.p0, 2.0) - 1.0;
    c = clamp(floor(c * n + t) / n, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(c * a, a) * u.tint;
  } else if (u.mode < 2.5) {
    // halftone — rotated dot grid, radius ∝ sqrt(luma), cell-color dots.
    let cell = max(u.p0, 2.0);
    let ang = radians(u.p1);
    let cs = cos(ang);
    let sn = sin(ang);
    let rot = mat2x2<f32>(vec2<f32>(cs, -sn), vec2<f32>(sn, cs));
    let inv = mat2x2<f32>(vec2<f32>(cs, sn), vec2<f32>(-sn, cs));
    let rp = rot * px;
    let centerR = (floor(rp / cell) + 0.5) * cell;
    let s = textureSampleLevel(tex, samp, (inv * centerR) / u.texSize, 0.0);
    let a = s.a;
    let c = straight(s);
    let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)) * a;
    let r = 0.5 * cell * sqrt(luma);
    let d = length(rp - centerR);
    let ink = (1.0 - smoothstep(r - 1.0, r + 1.0, d)) * clamp(r, 0.0, 1.0);
    return vec4<f32>(c, 1.0) * (a * ink) * u.tint;
  } else if (u.mode < 3.5) {
    // ascii — 10-glyph density ramp from the atlas, cell-color tint.
    let cell = max(u.p0, 4.0);
    let cellOrigin = floor(px / cell) * cell;
    let s = textureSampleLevel(tex, samp, (cellOrigin + 0.5 * cell) / u.texSize, 0.0);
    let a = s.a;
    let c = straight(s);
    let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)) * a;
    let idx = clamp(floor(luma * 10.0), 0.0, 9.0);
    let g = clamp(floor((px - cellOrigin) / cell * 8.0), vec2<f32>(0.0), vec2<f32>(7.0));
    let auxUv = vec2<f32>((idx * 8.0 + g.x + 0.5) / 80.0, (g.y + 0.5) / 8.0);
    let ink = textureSampleLevel(aux, samp, auxUv, 0.0).a;
    return vec4<f32>(c, 1.0) * (a * ink) * u.tint;
  } else if (u.mode < 4.5) {
    // drop_shadow — aux is the ladder-blurred layer; its alpha, offset
    // and tinted, composites UNDER the content.
    let c = textureSampleLevel(tex, samp, in.uv, 0.0);
    let texel = 1.0 / u.texSize;
    let ouv = clamp(in.uv - vec2<f32>(u.p0, u.p1) * texel, vec2<f32>(0.0), vec2<f32>(1.0));
    let sa = textureSampleLevel(aux, samp, ouv, 0.0).a;
    return c + u.tint * (sa * (1.0 - c.a));
  } else if (u.mode < 5.5) {
    // glow — blurred silhouette × intensity × color, under the content.
    let c = textureSampleLevel(tex, samp, in.uv, 0.0);
    let ga = clamp(textureSampleLevel(aux, samp, in.uv, 0.0).a * u.p0, 0.0, 1.0);
    return c + u.tint * (ga * (1.0 - c.a));
  } else if (u.mode < 6.5) {
    // stroke — outline band outside the silhouette: max alpha over a
    // 16-tap ring at the stroke width, under the content.
    let c = textureSampleLevel(tex, samp, in.uv, 0.0);
    let texel = 1.0 / u.texSize;
    let w = max(u.p0, 1.0);
    var s = 0.0;
    for (var i = 0; i < 16; i++) {
      let ang = 6.2831853 * f32(i) / 16.0;
      let tuv = clamp(in.uv + vec2<f32>(cos(ang), sin(ang)) * w * texel, vec2<f32>(0.0), vec2<f32>(1.0));
      s = max(s, textureSampleLevel(tex, samp, tuv, 0.0).a);
    }
    return c + u.tint * (s * (1.0 - c.a));
  } else if (u.mode < 7.5) {
    // chroma_key — BT.709 CbCr distance ramp (§4.7). u.tint.rgb = key
    // color (STRAIGHT), u.tint.a = spill; p0 tolerance, p1 softness.
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    var c = straight(s);
    let k = u.tint.rgb;
    let LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
    let cy = dot(c, LUMA);
    let ky = dot(k, LUMA);
    let cc = vec2<f32>((c.b - cy) / 1.8556, (c.r - cy) / 1.5748);
    let kc = vec2<f32>((k.b - ky) / 1.8556, (k.r - ky) / 1.5748);
    let d = distance(cc, kc);
    var a = select(
      select(1.0, 0.0, d <= u.p0),
      clamp((d - u.p0) / u.p1, 0.0, 1.0),
      u.p1 > 0.0);
    // Spill suppression: cap the key's dominant channel (ties g→r→b)
    // at the max of the other two, scaled by spill.
    if (k.g >= k.r && k.g >= k.b) {
      c.g -= u.tint.a * max(0.0, c.g - max(c.r, c.b));
    } else if (k.r >= k.b) {
      c.r -= u.tint.a * max(0.0, c.r - max(c.g, c.b));
    } else {
      c.b -= u.tint.a * max(0.0, c.b - max(c.r, c.g));
    }
    let ao = s.a * a;
    return vec4<f32>(c * ao, ao);
  } else if (u.mode < 8.5) {
    // luma_key — p0 threshold, p1 softness, u.tint.r = invert flag.
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let c = straight(s);
    let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    var a = select(
      select(1.0, 0.0, y <= u.p0),
      clamp((y - u.p0) / u.p1, 0.0, 1.0),
      u.p1 > 0.0);
    if (u.tint.x > 0.5) { a = 1.0 - a; }
    let ao = s.a * a;
    return vec4<f32>(c * ao, ao);
  } else if (u.mode < 9.5) {
    // levels — per-channel remap (§4.7): u.tint = (in_black, in_white,
    // out_black, out_white), p0 = gamma; y = x^(1/gamma).
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let c = straight(s);
    var x = clamp((c - u.tint.x) / max(u.tint.y - u.tint.x, 1e-5), vec3<f32>(0.0), vec3<f32>(1.0));
    x = pow(x, vec3<f32>(1.0 / max(u.p0, 1e-5)));
    let o = clamp(u.tint.z + x * (u.tint.w - u.tint.z), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(o * s.a, s.a);
  } else if (u.mode < 10.5) {
    // lut — 3D lattice packed as N slices along x in a 2D atlas (aux,
    // N²×N, slice index = blue). Manual trilinear: two bilinear taps
    // mixed across the blue axis. p0 = N, p1 = intensity.
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let c = straight(s);
    let n = max(u.p0, 2.0);
    let b = clamp(c.b, 0.0, 1.0) * (n - 1.0);
    let b0 = floor(b);
    let b1 = min(b0 + 1.0, n - 1.0);
    let cellUv = vec2<f32>(
      (clamp(c.r, 0.0, 1.0) * (n - 1.0) + 0.5) / (n * n),
      (clamp(c.g, 0.0, 1.0) * (n - 1.0) + 0.5) / n);
    let lo = textureSampleLevel(aux, samp, cellUv + vec2<f32>(b0 / n, 0.0), 0.0).rgb;
    let hi = textureSampleLevel(aux, samp, cellUv + vec2<f32>(b1 / n, 0.0), 0.0).rgb;
    let graded = mix(c, mix(lo, hi, b - b0), clamp(u.p1, 0.0, 1.0));
    return vec4<f32>(clamp(graded, vec3<f32>(0.0), vec3<f32>(1.0)) * s.a, s.a);
  } else if (u.mode < 11.5) {
    // fractal_noise — grayscale fBM over the element's footprint.
    // p0 = scale px, p1 = evolution,
    // u.tint = (offset_x/scale, offset_y/scale, octaves, seed).
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let v = fbm(
      vec3<f32>(px / max(u.p0, 1e-3) + u.tint.xy, u.p1),
      i32(u.tint.z + 0.5), u32(u.tint.w + 0.5));
    return vec4<f32>(vec3<f32>(v) * s.a, s.a);
  } else if (u.mode < 12.5) {
    // turbulent_displace — sample the layer at p + noise vector.
    // p0 = amount px, p1 = scale px, u.tint = (evolution, octaves, seed, 0).
    let sc = max(u.p1, 1e-3);
    let oct = i32(u.tint.y + 0.5);
    let sd = u32(u.tint.z + 0.5);
    let dx = fbm(vec3<f32>(px / sc, u.tint.x), oct, sd) - 0.5;
    let dy = fbm(vec3<f32>(px / sc, u.tint.x), oct, sd + 7919u) - 0.5;
    let duv = vec2<f32>(dx, dy) * 2.0 * u.p0 / u.texSize;
    return textureSampleLevel(tex, samp, clamp(in.uv + duv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  } else {
    // bloom_bright — extract pixels above a soft luma threshold for a
    // whole-frame bloom pass. p0 = threshold, p1 = knee. Straight bright
    // color, alpha 1, so the subsequent blur spreads it cleanly.
    let s = textureSampleLevel(tex, samp, in.uv, 0.0);
    let c = select(vec3<f32>(0.0), s.rgb / s.a, s.a > 0.0);
    let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    let f = clamp((l - u.p0) / max(u.p1, 1e-3), 0.0, 1.0);
    return vec4<f32>(c * f, 1.0);
  }
}
`;

// Glass composite (§4.7 'glass') — faithful port of the
// ybouane/liquidglass FS_GLASS shader onto our conventions. Analytic
// rounded-rect SDF + half-circle bevel, biconvex/dome refraction,
// Fresnel + Blinn-Phong lighting, inner stroke, outside-only drop
// shadow. Must match the WebGL GLASS_FS exactly.
// Two variants from one template — see the WebGL twin (glassFsSource)
// for the CKP/1.0 projective rationale. The non-projective source is
// byte-identical to the CKP/1.0 shader (the equivalence gate).
const glassShaderSource = (projective: boolean): string => /* wgsl */ `
struct GlassUniforms {
  transform: mat4x4<f32>,   // 64 bytes, offset 0
  tint: vec4<f32>,          // 16 bytes, offset 64 — STRAIGHT rgba
  texSize: vec2<f32>,       //  8 bytes, offset 80 — surface PHYSICAL dims
  paneCenter: vec2<f32>,    //  8 bytes, offset 88 — PHYSICAL px
  paneHalf: vec2<f32>,      //  8 bytes, offset 96 — PHYSICAL px
  rot: vec2<f32>,           //  8 bytes, offset 104 — (cos θ, sin θ)
  geo: vec4<f32>,           // 16 bytes, offset 112 — (radius, zRadius, bevelMode, bdFlip)
  optics: vec4<f32>,        // 16 bytes, offset 128 — (refract, chroma, edgeHL, fresnel)
  look: vec4<f32>,          // 16 bytes, offset 144 — (specular, saturation, alpha, 0)
  shadow: vec4<f32>,        // 16 bytes, offset 160 — (alpha, spread, offY, 0)${projective ? `
  hcol0: vec4<f32>,         // 16 bytes, offset 176 — pane→surface H, column 0 (xyz)
  hcol1: vec4<f32>,         // 16 bytes, offset 192
  hcol2: vec4<f32>,         // 16 bytes, offset 208
  hicol0: vec4<f32>,        // 16 bytes, offset 224 — inverse H columns
  hicol1: vec4<f32>,        // 16 bytes, offset 240
  hicol2: vec4<f32>,        // 16 bytes, offset 256
}                           // total: 272` : `
}                           // total: 176`}
@group(0) @binding(0) var<uniform> u: GlassUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var backdropTex: texture_2d<f32>;  // frosted
@group(0) @binding(3) var sharpTex: texture_2d<f32>;     // unblurred

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsMain(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.position = u.transform * vec4<f32>(pos, 0.0, 1.0);
  out.uv = uv;
  return out;
}

fn rrSDF(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + vec2<f32>(r, r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
}

// Half-circle bevel height field (reference bevelHeight).
fn bevelHeight(d: f32, zR: f32) -> f32 {
  if (d <= 0.0) { return 0.0; }
  if (d >= zR) { return zR; }
  return sqrt(d * (2.0 * zR - d));
}

fn straight3(s: vec4<f32>) -> vec3<f32> {
  return select(vec3<f32>(0.0), s.rgb / s.a, s.a > 0.0);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {${projective ? `
  // Pane-local coordinates: invert the pane→surface homography. A
  // non-positive w means the fragment looks past the plane's horizon
  // (behind the camera) — nothing there.
  let px = in.uv * u.texSize;
  let Hi = mat3x3<f32>(u.hicol0.xyz, u.hicol1.xyz, u.hicol2.xyz);
  let lh = Hi * vec3<f32>(px, 1.0);
  if (lh.z <= 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let p = lh.xy / lh.z;` : `
  // Pane-local coordinates (rotate surface px by −θ around the centre).
  let px = in.uv * u.texSize;
  let rel = px - u.paneCenter;
  let p = vec2<f32>(rel.x * u.rot.x + rel.y * u.rot.y,
                    -rel.x * u.rot.y + rel.y * u.rot.x);`}
  let half_ = u.paneHalf;
  let r = min(u.geo.x, min(half_.x, half_.y));
  let sdf = rrSDF(p, half_, r);

  // ── Drop shadow — OUTSIDE the panel only ──
  if (sdf > 0.0) {
    var a = 0.0;
    if (u.shadow.x > 0.0) {
      let sdfShadow = rrSDF(p - vec2<f32>(0.0, u.shadow.z), half_, r);
      let d = max(sdfShadow - 1.0, 0.0);
      let spread = max(u.shadow.y, 1.0);
      let falloff = 1.0 / (spread * spread);
      let outerShadow = exp(-d * d * falloff) * 0.65;
      let contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.35;
      a = (outerShadow + contactShadow) * u.shadow.x;
    }
    return vec4<f32>(0.0, 0.0, 0.0, a);
  }

  let mask = 1.0 - smoothstep(-1.5, 0.5, sdf);

  let maxD = min(half_.x, half_.y);
  let inside = -sdf;
  let edge = smoothstep(maxD * 0.35, 0.0, inside);

  // ── Surface normal via the bevel height field (e = 2px, analytic) ──
  let zR = u.geo.y;
  let e = 2.0;
  let hC = bevelHeight(inside, zR);
  let hGrad = vec2<f32>(
    bevelHeight(-rrSDF(p + vec2<f32>(e, 0.0), half_, r), zR) -
    bevelHeight(-rrSDF(p - vec2<f32>(e, 0.0), half_, r), zR),
    bevelHeight(-rrSDF(p + vec2<f32>(0.0, e), half_, r), zR) -
    bevelHeight(-rrSDF(p - vec2<f32>(0.0, e), half_, r), zR)) / (2.0 * e);
  let N = normalize(vec3<f32>(-hGrad, 1.0));

  let depth = smoothstep(0.0, zR, inside);

  // ── Refraction ──
  let refrPow = 1.0 - 1.0 / 1.5;
  let thickNorm = (hC * 2.0) / max(zR * 2.0, 1.0);
  var refrPx: vec2<f32>;
  if (u.geo.z < 0.5) {
    // Biconvex pill: entry + exit + through-thickness refraction,
    // plus a depth-scaled magnification pull toward the centre.
    let surfRefr = hGrad * refrPow;
    refrPx = (surfRefr * 2.0 + surfRefr * thickNorm * 0.5) * u.optics.x * 30.0;
    let centerDir = -p / max(half_, vec2<f32>(1.0, 1.0));
    refrPx += centerDir * u.optics.x * 4.0 * depth;
  } else {
    // Dome: uniform magnification — contract sampling toward centre.
    refrPx = -p * u.optics.x * depth * 0.35;
  }

  // ── Chromatic aberration ──
  let caS = u.optics.y * 18.0 * (edge * 0.7 + 0.3) * 2.0;
  let caD = N.xy * caS;

${projective ? `  // Pane-local sample points → surface px via the FORWARD homography
  // (refraction and aberration computed in the pane's frame).
  let Hm = mat3x3<f32>(u.hcol0.xyz, u.hcol1.xyz, u.hcol2.xyz);
  let fR = Hm * vec3<f32>(p + refrPx + caD, 1.0);
  let fG = Hm * vec3<f32>(p + refrPx, 1.0);
  let fB = Hm * vec3<f32>(p + refrPx - caD, 1.0);
  var uvR = clamp(fR.xy / (max(fR.z, 1e-4) * u.texSize), vec2<f32>(0.0), vec2<f32>(1.0));
  var uvG = clamp(fG.xy / (max(fG.z, 1e-4) * u.texSize), vec2<f32>(0.0), vec2<f32>(1.0));
  var uvB = clamp(fB.xy / (max(fB.z, 1e-4) * u.texSize), vec2<f32>(0.0), vec2<f32>(1.0));` : `  // Pane-local offsets → surface space (rotate by +θ) → uv.
  let refrW = vec2<f32>(refrPx.x * u.rot.x - refrPx.y * u.rot.y,
                        refrPx.x * u.rot.y + refrPx.y * u.rot.x);
  let caW = vec2<f32>(caD.x * u.rot.x - caD.y * u.rot.y,
                      caD.x * u.rot.y + caD.y * u.rot.x);
  let base = in.uv + refrW / u.texSize;
  let oCA = caW / u.texSize;
  var uvR = clamp(base + oCA, vec2<f32>(0.0), vec2<f32>(1.0));
  var uvG = clamp(base, vec2<f32>(0.0), vec2<f32>(1.0));
  var uvB = clamp(base - oCA, vec2<f32>(0.0), vec2<f32>(1.0));`}
  if (u.geo.w > 0.5) { // GL-canvas snapshots are bottom-up
    uvR.y = 1.0 - uvR.y; uvG.y = 1.0 - uvG.y; uvB.y = 1.0 - uvB.y;
  }

  let sharpC = vec3<f32>(
    straight3(textureSampleLevel(sharpTex, samp, uvR, 0.0)).r,
    straight3(textureSampleLevel(sharpTex, samp, uvG, 0.0)).g,
    straight3(textureSampleLevel(sharpTex, samp, uvB, 0.0)).b);
  let blurC = vec3<f32>(
    straight3(textureSampleLevel(backdropTex, samp, uvR, 0.0)).r,
    straight3(textureSampleLevel(backdropTex, samp, uvG, 0.0)).g,
    straight3(textureSampleLevel(backdropTex, samp, uvB, 0.0)).b);
  // Edge-weighted blur mix: centre fully frosted, rim 15% sharp.
  let edgeMix = 1.0 - edge * 0.15;
  var col = mix(sharpC, blurC, edgeMix);

  // ── Saturation (0 = unchanged) ──
  let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
  col = mix(vec3<f32>(lum), col, 1.0 + u.look.y);

  // ── Tint ──
  col = mix(col, u.tint.rgb, u.tint.a);
  col *= 1.0 + 0.06 * depth;

  // ── Fresnel ──
  let fres = pow(1.0 - abs(N.z), 4.0) * u.optics.w;

  // ── Specular highlights (multi-light Blinn-Phong, reference lights) ──
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let L1 = normalize(vec3<f32>(0.4, 0.7, 1.0));
  var sp = pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0);
  let L2 = normalize(vec3<f32>(-0.3, -0.5, 1.0));
  sp += pow(max(dot(N, normalize(L2 + V)), 0.0), 50.0) * 0.3;
  let L3 = normalize(vec3<f32>(0.1, 0.3, 1.0));
  sp += pow(max(dot(N, L3), 0.0), 6.0) * 0.1;
  let L4 = normalize(vec3<f32>(0.0, 0.9, 0.4));
  sp += pow(max(dot(N, normalize(L4 + V)), 0.0), 120.0) * 0.6;
  let totalSpec = sp * u.look.x;

  // ── Inner border / stroke highlight ──
  let borderWidth = 1.5;
  var innerStroke = smoothstep(-borderWidth - 1.0, -borderWidth, sdf)
                  * (1.0 - smoothstep(-1.0, 0.0, sdf));
  let topBias = 0.5 + 0.5 * (-p.y / half_.y);
  innerStroke *= (0.4 + 0.6 * topBias);

  // ── Edge highlight & inner glow ──
  let rim = edge * u.optics.z * 0.22;
  let innerGlow = smoothstep(5.0, 0.0, -sdf) * u.optics.z * 0.15;

  // ── Environment-like reflection (fake) ──
  let envRefl = (N.y * 0.5 + 0.5) * fres * 0.08;

  // ── Composite ──
  var fin = col;
  fin += vec3<f32>(totalSpec);
  fin += vec3<f32>(rim + innerGlow);
  fin += vec3<f32>(innerStroke * u.optics.z * 0.55);
  fin += vec3<f32>(envRefl);
  fin = mix(fin, vec3<f32>(1.0), fres * 0.2);

  let outA = mask * u.look.z;
  return vec4<f32>(clamp(fin, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0) * outA;
}
`;

// ─── Unit quad geometry ─────────────────────────────────────────────────────
//
// 6 vertices, 2 triangles. Each vertex: (pos.xy, uv.xy), 16 bytes.
// UVs match the quad's screen orientation: position y=+1 (top) → uv v=0 (top of texture).
//
//   (-1, +1) uv (0, 0) ────────── (+1, +1) uv (1, 0)
//      │  Top-left                     │  Top-right
//      │                               │
//   (-1, -1) uv (0, 1) ────────── (+1, -1) uv (1, 1)
//      Bottom-left                  Bottom-right

// prettier-ignore
const UNIT_QUAD_VERTICES = new Float32Array([
  // tri 1
  -1, -1, 0, 1,  //   BL → uv (0, 1)
   1, -1, 1, 1,  //   BR → uv (1, 1)
  -1,  1, 0, 0,  //   TL → uv (0, 0)
  // tri 2
  -1,  1, 0, 0,  //   TL
   1, -1, 1, 1,  //   BR
   1,  1, 1, 0,  //   TR
]);

const VERTEX_STRIDE = 16;

// ─── Implementation ─────────────────────────────────────────────────────────

export class WebGPUBackend implements Backend {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;

  capabilities!: BackendCapabilities;

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private sampler!: GPUSampler;
  private vertexBuffer!: GPUBuffer;

  private shapePipeline!: GPURenderPipeline;
  private litShapePipeline!: GPURenderPipeline;
  private litShapeBindGroupLayout!: GPUBindGroupLayout;
  private litTexturedPipeline!: GPURenderPipeline;
  private litTexturedBindGroupLayout!: GPUBindGroupLayout;
  private flatNormalView: GPUTextureView | null = null;
  private shadowPipeline!: GPURenderPipeline;
  private gradientPipeline!: GPURenderPipeline;
  private texturedPipeline!: GPURenderPipeline;
  private maskedPipeline!: GPURenderPipeline;
  private filteredPipeline!: GPURenderPipeline;
  private stylizedPipeline!: GPURenderPipeline;
  private glassPipeline!: GPURenderPipeline;
  private backdropBlendPipeline!: GPURenderPipeline;
  // Lazy projective variant (CKP/1.0 glass under 3D) — created on
  // first use so 2D documents never pay for it.
  private glass3dPipeline: GPURenderPipeline | null = null;
  /**
   * Non-normal blend variants, keyed `${pipelineName}:${blendMode}`.
   * WebGPU bakes blend state into the pipeline at creation time (unlike
   * GL's mutable blendFunc), so each blendable pipeline gets a variant
   * per supported mode, built eagerly at init. Shadow stays normal-only.
   */
  private blendVariants = new Map<string, GPURenderPipeline>();
  private shapeBindGroupLayout!: GPUBindGroupLayout;
  private shadowBindGroupLayout!: GPUBindGroupLayout;
  private gradientBindGroupLayout!: GPUBindGroupLayout;
  private texturedBindGroupLayout!: GPUBindGroupLayout;
  private maskedBindGroupLayout!: GPUBindGroupLayout;

  // Per-frame command recording state.
  private commandEncoder: GPUCommandEncoder | null = null;
  private passEncoder: GPURenderPassEncoder | null = null;
  /** The swap-chain view of the frame in progress (popTarget resumes onto it). */
  private canvasView: GPUTextureView | null = null;
  /** The swap-chain texture itself — copySurfaceTo's source at the root. */
  private canvasTexture: GPUTexture | null = null;

  /** Physical backing-store dims ÷ logical dims (renderResolution). */
  private pixelRatio = 1;
  /**
   * Offscreen-surface stack. WebGPU can't redirect a pass mid-flight,
   * so push/pop END the current render pass and BEGIN a new one on the
   * next surface (loadOp 'load' preserves prior contents on resume).
   */
  private surfaceStack: Array<{ view: GPUTextureView; texture: GPUTexture; width: number; height: number }> = [];
  private renderTargets = new Set<RenderTarget>();

  private currentSurface(): { view: GPUTextureView | null; width: number; height: number } {
    const top = this.surfaceStack[this.surfaceStack.length - 1];
    if (top) return top;
    return { view: this.canvasView, width: this.width, height: this.height };
  }

  // Uniform buffer pool. Pre-allocate GPUBuffers and reuse them across frames
  // (via queue.writeBuffer). Without this we'd allocate ~50+ GPUBuffers per
  // frame for a caption-heavy source, generating enough GC pressure to stall
  // the main thread and visibly stutter playback.
  //
  // Sized to fit the largest uniform struct (gradient = 176 bytes, rounded
  // up to 192 for 16-byte alignment). Solid shape (96 B) and textured-quad
  // (96 B) write the first 96 bytes only; remainder is unused.
  private uniformBufferPool: GPUBuffer[] = [];
  private uniformBufferIndex = 0;
  private uniformScratch = new Float32Array(136); // 544 bytes (lit pass is the largest, 528 used)
  // Sized for the largest uniform struct (glass3d: 272 bytes, padded).
  private static readonly UNIFORM_SIZE = 544;

  private nextTextureId = 1;
  /** Set after the first failed direct VideoFrame copy — see uploadToTexture. */
  private videoDirectCopyBroken = false;
  private videoBlitCanvas: OffscreenCanvas | null = null;
  private liveTextures = new Set<WebGPUTexture>();

  private disposed = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  async init(): Promise<boolean> {
    const log = getLogger();
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      log.warn('WebGPU not available in this environment');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        log.warn('No WebGPU adapter available');
        return false;
      }

      this.device = await adapter.requestDevice();
      this.device.addEventListener('uncapturederror', (event) => {
        log.error('WebGPU uncaptured error:', (event as GPUUncapturedErrorEvent).error.message);
      });
      this.device.lost.then((info) => {
        log.error('WebGPU device lost:', info.message, info.reason);
      });

      // Canvas context.
      const ctx = this.canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) {
        log.error('Failed to get WebGPU canvas context');
        return false;
      }
      this.context = ctx;
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, // COPY_SRC: glass backdrop snapshots
      });

      // Shared sampler (linear filtering for both image and text).
      this.sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      // Shared unit-quad vertex buffer.
      this.vertexBuffer = this.device.createBuffer({
        size: UNIT_QUAD_VERTICES.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.vertexBuffer, 0, UNIT_QUAD_VERTICES);

      // Pipelines.
      await this.buildShapePipeline();
      await this.buildShadowPipeline();
      await this.buildGradientPipeline();
      await this.buildTexturedPipeline();

      this.capabilities = {
        api: 'webgpu',
        maxTextureSize: this.device.limits.maxTextureDimension2D,
      };

      log.info(`WebGPU backend ready (maxTextureSize=${this.capabilities.maxTextureSize})`);
      return true;
    } catch (err) {
      log.error('WebGPU init failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  resize(width: number, height: number, pixelRatio: number = 1): void {
    if (this.disposed) return;
    const physW = Math.max(1, Math.round(width * pixelRatio));
    const physH = Math.max(1, Math.round(height * pixelRatio));
    if (
      width === this.width &&
      height === this.height &&
      this.canvas.width === physW &&
      this.canvas.height === physH
    ) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.canvas.width = physW;
    this.canvas.height = physH;
    // WebGPU canvases auto-resize the swap chain to canvas.{width,height},
    // but reconfiguring is the safest way to ensure the next frame uses
    // the new dimensions.
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, // COPY_SRC: glass backdrop snapshots
    });
  }

  // ─── Pipelines ────────────────────────────────────────────────────────────

  /** Build one render pipeline over the shared unit quad. */
  private makePipeline(
    label: string,
    module: GPUShaderModule,
    bindGroupLayout: GPUBindGroupLayout,
    blend: GPUBlendState,
  ): GPURenderPipeline {
    return this.device.createRenderPipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: VERTEX_STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{ format: this.format, blend }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Build the normal-blend pipeline plus multiply/screen/add variants
   * (registered in `blendVariants` under `${name}:${mode}`).
   */
  private makeBlendablePipeline(
    name: string,
    module: GPUShaderModule,
    bindGroupLayout: GPUBindGroupLayout,
  ): GPURenderPipeline {
    for (const mode of ['multiply', 'screen', 'add'] as const) {
      this.blendVariants.set(
        `${name}:${mode}`,
        this.makePipeline(`${name} pipeline (${mode})`, module, bindGroupLayout, BLEND_STATES[mode]),
      );
    }
    return this.makePipeline(`${name} pipeline`, module, bindGroupLayout, PREMUL_BLEND);
  }

  /** Pick the pipeline for a draw's blend mode (missing/normal → base). */
  private pipelineFor(
    base: GPURenderPipeline,
    name: string,
    blend: BlendMode | undefined,
  ): GPURenderPipeline {
    if (!blend || blend === 'normal') return base;
    return this.blendVariants.get(`${name}:${blend}`) ?? base;
  }

  private async buildShapePipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: SHAPE_SHADER, label: 'shape' });
    await this.checkShaderCompilation(module, 'shape');

    this.shapeBindGroupLayout = this.device.createBindGroupLayout({
      label: 'shape bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.shapePipeline = this.makeBlendablePipeline('shape', module, this.shapeBindGroupLayout);

    // Lit variant (§4.8) — same single-uniform bind-group shape, larger
    // uniform struct. Built alongside the shape pipeline; unlit documents
    // simply never bind it.
    const litModule = this.device.createShaderModule({ code: LIT_SHAPE_SHADER, label: 'litShape' });
    await this.checkShaderCompilation(litModule, 'litShape');
    // uniform + sampler + normal-map texture + env texture (all bound;
    // defaults to a 1×1 flat texture when absent).
    this.litShapeBindGroupLayout = this.device.createBindGroupLayout({
      label: 'litShape bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this.litShapePipeline = this.makeBlendablePipeline('litShape', litModule, this.litShapeBindGroupLayout);
  }

  private async buildShadowPipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: SHADOW_SHADER, label: 'shadow' });
    await this.checkShaderCompilation(module, 'shadow');

    this.shadowBindGroupLayout = this.device.createBindGroupLayout({
      label: 'shadow bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Shadows always composite normally — they sit behind their shape.
    this.shadowPipeline = this.makePipeline('shadow pipeline', module, this.shadowBindGroupLayout, PREMUL_BLEND);
  }

  private async buildGradientPipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: GRADIENT_SHADER, label: 'gradient' });
    await this.checkShaderCompilation(module, 'gradient');

    this.gradientBindGroupLayout = this.device.createBindGroupLayout({
      label: 'gradient bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.gradientPipeline = this.makeBlendablePipeline('gradient', module, this.gradientBindGroupLayout);
  }

  private async buildTexturedPipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: TEXTURED_SHADER, label: 'textured' });
    await this.checkShaderCompilation(module, 'textured');

    this.texturedBindGroupLayout = this.device.createBindGroupLayout({
      label: 'textured bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });

    this.texturedPipeline = this.makeBlendablePipeline('textured', module, this.texturedBindGroupLayout);

    // Lit textured variant (§4.8) — same bind-group shape (uniform +
    // sampler + texture), larger uniform struct. Lit images / video /
    // group cards.
    const litTexModule = this.device.createShaderModule({ code: LIT_TEXTURED_SHADER, label: 'litTextured' });
    await this.checkShaderCompilation(litTexModule, 'litTextured');
    // uniform + sampler + albedo + normal-map + env texture.
    this.litTexturedBindGroupLayout = this.device.createBindGroupLayout({
      label: 'litTextured bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this.litTexturedPipeline = this.makeBlendablePipeline('litTextured', litTexModule, this.litTexturedBindGroupLayout);

    const maskedModule = this.device.createShaderModule({ code: MASKED_SHADER, label: 'masked' });
    await this.checkShaderCompilation(maskedModule, 'masked');

    this.maskedBindGroupLayout = this.device.createBindGroupLayout({
      label: 'masked bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });

    this.maskedPipeline = this.makeBlendablePipeline('masked', maskedModule, this.maskedBindGroupLayout);

    // Filtered composite — same bind-group shape as the textured
    // pipeline (uniform + sampler + one texture), so the layout is
    // shared rather than duplicated.
    const filteredModule = this.device.createShaderModule({ code: FILTERED_SHADER, label: 'filtered' });
    await this.checkShaderCompilation(filteredModule, 'filtered');
    this.filteredPipeline = this.makeBlendablePipeline('filtered', filteredModule, this.texturedBindGroupLayout);

    // Stylize pass — same bind-group shape as masked (uniform +
    // sampler + two textures), so that layout is shared.
    const stylizedModule = this.device.createShaderModule({ code: STYLIZED_SHADER, label: 'stylized' });
    await this.checkShaderCompilation(stylizedModule, 'stylized');
    this.stylizedPipeline = this.makeBlendablePipeline('stylized', stylizedModule, this.maskedBindGroupLayout);

    // Glass — two textures (frosted + sharp backdrop snapshots); the
    // bind-group shape matches masked, so that layout is shared.
    const glassModule = this.device.createShaderModule({ code: glassShaderSource(false), label: 'glass' });
    await this.checkShaderCompilation(glassModule, 'glass');
    this.glassPipeline = this.makeBlendablePipeline('glass', glassModule, this.maskedBindGroupLayout);

    // Backdrop-blend — outputs the full composite, so REPLACE blend
    // (not over). Shares the masked bind-group shape (uniform + sampler
    // + 2 textures). Single pipeline; the piecewise mode is a uniform.
    const bbModule = this.device.createShaderModule({ code: BACKDROP_BLEND_SHADER, label: 'backdropBlend' });
    await this.checkShaderCompilation(bbModule, 'backdropBlend');
    this.backdropBlendPipeline = this.makePipeline('backdropBlend', bbModule, this.maskedBindGroupLayout, REPLACE_BLEND);
  }

  private async checkShaderCompilation(module: GPUShaderModule, label: string): Promise<void> {
    const info = await module.getCompilationInfo();
    const log = getLogger();
    for (const msg of info.messages) {
      const where = `${label}.wgsl:${msg.lineNum}:${msg.linePos}`;
      if (msg.type === 'error') log.error(`Shader ${where}: ${msg.message}`);
      else if (msg.type === 'warning') log.warn(`Shader ${where}: ${msg.message}`);
    }
  }

  // ─── Textures ─────────────────────────────────────────────────────────────

  createTexture(source: TextureSource): Texture {
    const { width, height } = sourceDimensions(source);
    const gpuTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.uploadToTexture(gpuTexture, source, width, height);
    const texture: WebGPUTexture = {
      id: this.nextTextureId++,
      width,
      height,
      gpuTexture,
      view: gpuTexture.createView(),
    };
    this.liveTextures.add(texture);
    return texture;
  }

  updateTexture(texture: Texture, source: TextureSource): void {
    const t = texture as WebGPUTexture;
    this.uploadToTexture(t.gpuTexture, source, t.width, t.height);
  }

  private uploadToTexture(
    gpuTexture: GPUTexture,
    source: TextureSource,
    width: number,
    height: number,
  ): void {
    // VideoFrame uses a different copy call.
    if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
      if (!this.videoDirectCopyBroken) {
        try {
          this.device.queue.copyExternalImageToTexture(
            { source },
            { texture: gpuTexture, premultipliedAlpha: true },
            { width, height },
          );
          return;
        } catch {
          // Chromium rejects the direct copy for some VideoDecoder
          // output frames ("Copy rect is out of bounds of external
          // image"). Remember and route every video upload through the
          // 2D blit below — without this, video preload throws and the
          // runtime degrades to the approximate <video>-seek path.
          this.videoDirectCopyBroken = true;
          getLogger().warn('Direct VideoFrame→GPUTexture copy unavailable; using canvas blit.');
        }
      }
      let canvas = this.videoBlitCanvas;
      if (!canvas) {
        canvas = new OffscreenCanvas(width, height);
        this.videoBlitCanvas = canvas;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.drawImage(source, 0, 0, width, height);
      this.device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture: gpuTexture, premultipliedAlpha: true },
        { width, height },
      );
      return;
    }
    this.device.queue.copyExternalImageToTexture(
      { source: source as Exclude<TextureSource, VideoFrame> },
      { texture: gpuTexture, premultipliedAlpha: true },
      { width, height },
    );
  }

  destroyTexture(texture: Texture): void {
    const t = texture as WebGPUTexture;
    if (this.liveTextures.delete(t)) {
      t.gpuTexture.destroy();
    }
  }

  // ─── Frame lifecycle ──────────────────────────────────────────────────────

  beginFrame(clearColor: RGBA = [0, 0, 0, 1]): void {
    if (this.passEncoder) {
      getLogger().warn('beginFrame called while another frame is in progress; ending the previous one');
      this.endFrame();
    }
    this.commandEncoder = this.device.createCommandEncoder({ label: 'frame' });
    this.canvasTexture = this.context.getCurrentTexture();
    this.canvasView = this.canvasTexture.createView();
    this.surfaceStack.length = 0;
    this.passEncoder = this.commandEncoder.beginRenderPass({
      label: 'main pass',
      colorAttachments: [
        {
          view: this.canvasView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
        },
      ],
    });
    this.passEncoder.setVertexBuffer(0, this.vertexBuffer);

    // Reset uniform pool — buffers from previous frames are now eligible for reuse.
    this.uniformBufferIndex = 0;
  }

  /** End the active pass and begin a new one on `view`. */
  private restartPass(
    view: GPUTextureView,
    loadOp: GPULoadOp,
    clearColor: RGBA = [0, 0, 0, 0],
  ): void {
    if (!this.commandEncoder) return;
    this.passEncoder?.end();
    this.passEncoder = this.commandEncoder.beginRenderPass({
      label: loadOp === 'clear' ? 'target pass' : 'resume pass',
      colorAttachments: [
        {
          view,
          loadOp,
          storeOp: 'store',
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
        },
      ],
    });
    this.passEncoder.setVertexBuffer(0, this.vertexBuffer);
  }

  // ─── Offscreen render targets ─────────────────────────────────────────────

  createRenderTarget(width: number, height: number): RenderTarget {
    const physW = Math.max(1, Math.round(width * this.pixelRatio));
    const physH = Math.max(1, Math.round(height * this.pixelRatio));
    const gpuTexture = this.device.createTexture({
      label: 'render target',
      size: { width: physW, height: physH },
      format: this.format,
      // COPY_SRC/COPY_DST: targets are both source (when a glass element
      // sits inside a clipped group) and destination of backdrop
      // snapshots (copySurfaceTo).
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    const texture: WebGPUTexture = {
      id: this.nextTextureId++,
      width: physW,
      height: physH,
      gpuTexture,
      view: gpuTexture.createView(),
    };
    this.liveTextures.add(texture);
    const target: RenderTarget = { texture, width, height };
    this.renderTargets.add(target);
    return target;
  }

  destroyRenderTarget(target: RenderTarget): void {
    this.renderTargets.delete(target);
    this.destroyTexture(target.texture);
  }

  pushTarget(target: RenderTarget, clearColor: RGBA = [0, 0, 0, 0]): void {
    if (!this.passEncoder) return;
    if (!this.renderTargets.has(target)) {
      getLogger().warn('pushTarget with unknown / destroyed target — ignored');
      return;
    }
    const tex = target.texture as WebGPUTexture;
    this.surfaceStack.push({ view: tex.view, texture: tex.gpuTexture, width: target.width, height: target.height });
    this.restartPass(tex.view, 'clear', clearColor);
  }

  popTarget(): void {
    if (this.surfaceStack.length === 0) {
      getLogger().warn('popTarget without matching pushTarget — ignored');
      return;
    }
    this.surfaceStack.pop();
    const s = this.currentSurface();
    if (!s.view) return;
    // Resume on the previous surface, PRESERVING what's already drawn.
    this.restartPass(s.view, 'load');
  }

  /**
   * Acquire the next free uniform buffer from the pool. Grows the pool by
   * one buffer when exhausted. Buffers are reused across frames; the queue
   * serializes writes so it's safe to overwrite them once beginFrame resets
   * the index.
   */
  private acquireUniformBuffer(): GPUBuffer {
    let buffer = this.uniformBufferPool[this.uniformBufferIndex];
    if (!buffer) {
      buffer = this.device.createBuffer({
        label: `pooled uniform [${this.uniformBufferIndex}]`,
        size: WebGPUBackend.UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniformBufferPool.push(buffer);
    }
    this.uniformBufferIndex++;
    return buffer;
  }

  endFrame(): void {
    if (!this.passEncoder || !this.commandEncoder) return;
    this.passEncoder.end();
    this.device.queue.submit([this.commandEncoder.finish()]);
    this.passEncoder = null;
    this.commandEncoder = null;
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  drawShapeShadow(params: ShapeShadowDrawParams): void {
    if (!this.passEncoder) return;
    if (params.blur <= 0 && params.offsetX === 0 && params.offsetY === 0) return;
    const blur = Math.max(0, params.blur);
    const quadW = params.width + blur * 2;
    const quadH = params.height + blur * 2;
    const surface = this.currentSurface();
    const transform = params.transform
      ? projectPixelMatrix(params.transform, surface.width, surface.height, false)
      : composeQuadTransform(
          params.cx + params.offsetX,
          params.cy + params.offsetY,
          quadW,
          quadH,
          params.rotation,
          surface.width,
          surface.height,
          params.skewX ?? 0,
          params.skewY ?? 0,
        );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    // 128-byte layout matching SHADOW_SHADER ShadowUniforms:
    //   0..15   transform
    //   16..19  color
    //   20      cornerRadius
    //   21      shapeType
    //   22      blur
    //   23      _pad0
    //   24..25  size
    //   26..27  quadSize
    //   28..31  _pad1
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(params.color, 16);
    data[20] = cornerRadius;
    data[21] = shapeType;
    data[22] = blur;
    data[23] = 0;
    data[24] = params.width;
    data[25] = params.height;
    data[26] = quadW;
    data[27] = quadH;
    data[28] = 0; data[29] = 0; data[30] = 0; data[31] = 0;

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 128);

    const bindGroup = this.device.createBindGroup({
      layout: this.shadowBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    });

    this.passEncoder.setPipeline(this.shadowPipeline);
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawShape(params: ShapeDrawParams): void {
    if (!this.passEncoder) return;
    if (params.gradient) {
      this.drawGradientShape(params);
      return;
    }
    if (params.lit) {
      this.drawLitShape(params);
      return;
    }

    const surfaceA = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surfaceA.width, surfaceA.height, false)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surfaceA.width, surfaceA.height, params.skewX ?? 0, params.skewY ?? 0,
        );
    // cornerRadius is now PIXELS (no longer normalized). Clamp to half the
    // smaller dimension so a radius bigger than the quad doesn't overflow.
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    // 128-byte layout (rounded up from 120 for uniform-buffer alignment):
    //   0..15   transform (mat4)
    //   16..19  color (fill)
    //   20..23  strokeColor
    //   24      cornerRadius
    //   25      shapeType
    //   26..27  size (w, h)
    //   28      strokeWidth
    //   29      _pad
    const sw = params.strokeWidth ?? 0;
    const sc = params.strokeColor ?? params.color;
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(params.color, 16);
    data.set(sc, 20);
    data[24] = cornerRadius;
    data[25] = shapeType;
    data[26] = params.width;
    data[27] = params.height;
    data[28] = sw;
    data[29] = 0; // pad

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 128);

    const bindGroup = this.device.createBindGroup({
      layout: this.shapeBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.shapePipeline, 'shape', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  private drawLitShape(params: ShapeDrawParams): void {
    if (!this.passEncoder || !params.lit) return;
    const lit = params.lit;

    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, false)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0,
        );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;
    const sw = params.strokeWidth ?? 0;
    const salb = lit.strokeAlbedo ?? lit.albedo;

    // 496-byte layout matching LitUniforms (see LIT_SHAPE_SHADER).
    const data = this.uniformScratch;
    data.set(transform, 0);                       // transform  @ 0
    data.set(lit.albedo, 32);                     // albedo     @ 128
    data.set(salb, 36);                           // strokeAlbedo @ 144
    data[52] = cornerRadius; data[53] = shapeType; data[54] = sw; // params0.xyz @ 208 (.w = numLights set below)
    data[60] = params.width; data[61] = params.height; data[62] = 0; data[63] = 0; // size @ 240
    this.packLitPbr(data, lit);

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 528);

    const normalView = lit.normalMap ? (lit.normalMap.texture as WebGPUTexture).view : this.getFlatNormalView();
    const envView = lit.env?.image ? (lit.env.image as WebGPUTexture).view : this.getFlatNormalView();
    const bindGroup = this.device.createBindGroup({
      layout: this.litShapeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: normalView },
        { binding: 3, resource: envView },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.litShapePipeline, 'litShape', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  // Fill the PBR-shared LitUniforms slots (worldMatrix, normal, eye,
  // ambient, params0.w numLights, params1, lights, environment). Callers
  // write the variant slots (transform, albedo/tint, strokeAlbedo/uvRect,
  // params0.xyz, size) before calling.
  private packLitPbr(data: Float32Array, lit: LitParams): void {
    data.set(lit.worldMatrix as ArrayLike<number>, 16);   // worldMatrix @ 64
    data[40] = lit.normal[0]; data[41] = lit.normal[1]; data[42] = lit.normal[2]; data[43] = 0; // normal @ 160
    data[44] = lit.eye[0]; data[45] = lit.eye[1]; data[46] = lit.eye[2]; data[47] = 0;          // eye    @ 176
    data[48] = lit.ambient[0]; data[49] = lit.ambient[1]; data[50] = lit.ambient[2]; data[51] = 0; // ambient @ 192
    data[55] = Math.min(4, lit.lightDirs.length);         // params0.w numLights @ 220
    data[56] = lit.roughness; data[57] = lit.metalness; data[58] = lit.reflectivity; data[59] = lit.emissive; // params1 @ 224
    for (let i = 0; i < 4; i++) {                          // lightDir[4] @ 256
      const d = lit.lightDirs[i];
      const base = 64 + i * 4;
      data[base] = d ? d[0] : 0; data[base + 1] = d ? d[1] : 0; data[base + 2] = d ? d[2] : 0; data[base + 3] = 0;
    }
    for (let i = 0; i < 4; i++) {                          // lightColor[4] @ 320
      const c = lit.lightColors[i];
      const base = 80 + i * 4;
      data[base] = c ? c[0] : 0; data[base + 1] = c ? c[1] : 0; data[base + 2] = c ? c[2] : 0; data[base + 3] = 0;
    }
    const env = lit.env;
    const ec = env ? Math.min(4, env.stopColors.length) : 0;
    for (let i = 0; i < 4; i++) {                          // envColor[4] @ 384
      const c = env && i < ec ? env.stopColors[i] : undefined;
      const base = 96 + i * 4;
      data[base] = c ? c[0] : 0; data[base + 1] = c ? c[1] : 0; data[base + 2] = c ? c[2] : 0; data[base + 3] = 0;
    }
    // envParams: x=stopCount, y=normalScale, z=hasNormalMap, w=envIsImage.
    const nm = lit.normalMap;
    const envIsImage = lit.env?.image ? 1 : 0;
    data[112] = ec; data[113] = nm ? nm.scale : 1; data[114] = nm ? 1 : 0; data[115] = envIsImage; // envParams @ 448
    for (let i = 0; i < 4; i++) data[116 + i] = env && i < ec ? env.stopOffsets[i]! : 0; // envOffsets @ 464
    data[120] = env ? env.avg[0] : 0; data[121] = env ? env.avg[1] : 0; data[122] = env ? env.avg[2] : 0; data[123] = 0; // envAvg @ 480
    // tangent @ 496 (float 124), bitangent @ 512 (float 128).
    data[124] = nm ? nm.tangent[0] : 1; data[125] = nm ? nm.tangent[1] : 0; data[126] = nm ? nm.tangent[2] : 0; data[127] = 0;
    data[128] = nm ? nm.bitangent[0] : 0; data[129] = nm ? nm.bitangent[1] : 1; data[130] = nm ? nm.bitangent[2] : 0; data[131] = 0;
  }

  // 1×1 flat tangent-space normal (#8080ff) bound when a lit draw has no
  // normal map, so the sampler binding is always valid.
  private getFlatNormalView(): GPUTextureView {
    if (!this.flatNormalView) {
      const tex = this.device.createTexture({
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture: tex },
        new Uint8Array([128, 128, 255, 255]),
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1 },
      );
      this.flatNormalView = tex.createView();
    }
    return this.flatNormalView;
  }

  private drawLitTexturedQuad(params: TexturedQuadDrawParams): void {
    if (!this.passEncoder || !params.lit) return;
    const lit = params.lit;
    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, false)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0,
        );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const uvRect = params.uvRect ?? [0, 0, 1, 1];
    const tint = params.tint ?? [1, 1, 1, 1];

    // Reuse LitUniforms: albedo slot = premultiplied tint, strokeAlbedo
    // slot = uvRect, params0.x = cornerRadius. (See LIT_TEXTURED_SHADER.)
    const data = this.uniformScratch;
    data.set(transform, 0);                       // transform @ 0
    data[32] = tint[0]; data[33] = tint[1]; data[34] = tint[2]; data[35] = tint[3]; // tint @ 128
    data[36] = uvRect[0]; data[37] = uvRect[1]; data[38] = uvRect[2]; data[39] = uvRect[3]; // uvRect @ 144
    data[52] = cornerRadius; data[53] = 0; data[54] = 0; // params0.xyz @ 208
    data[60] = params.width; data[61] = params.height; data[62] = 0; data[63] = 0; // size @ 240
    this.packLitPbr(data, lit);

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 528);

    const tex = params.texture as WebGPUTexture;
    const normalView = lit.normalMap ? (lit.normalMap.texture as WebGPUTexture).view : this.getFlatNormalView();
    const envView = lit.env?.image ? (lit.env.image as WebGPUTexture).view : this.getFlatNormalView();
    const bindGroup = this.device.createBindGroup({
      layout: this.litTexturedBindGroupLayout,   // uniform + sampler + albedo + normal + env
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: tex.view },
        { binding: 3, resource: normalView },
        { binding: 4, resource: envView },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.litTexturedPipeline, 'litTextured', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  private drawGradientShape(params: ShapeDrawParams): void {
    if (!this.passEncoder || !params.gradient) return;

    const surfaceB = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surfaceB.width, surfaceB.height, false)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surfaceB.width, surfaceB.height, params.skewX ?? 0, params.skewY ?? 0,
        );
    // cornerRadius in PIXELS (no longer normalized). See drawShape comment.
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    const g = params.gradient;
    const fillType = g.type === 'radial' ? 1 : 0;
    const stops = g.stops.slice(0, 4);
    const nStops = Math.max(2, stops.length);

    // 192-byte layout:
    //   0..63    transform (16 floats)
    //   64..79   flags (cornerRadius_PX, shapeType, fillType, numStops)
    //   80..95   params (linear: cos, sin, 0, 0 | radial: cx, cy, radius, 0)
    //   96..111  size (width_px, height_px, 0, 0)
    //   112..175 stops[4] colors (4 × vec4)
    //   176..191 stopOffsets (4 floats)
    const data = this.uniformScratch;
    data.set(transform, 0);
    data[16] = cornerRadius;
    data[17] = shapeType;
    data[18] = fillType;
    data[19] = nStops;

    if (g.type === 'linear') {
      data[20] = Math.cos(g.angle);
      data[21] = Math.sin(g.angle);
      data[22] = 0;
      data[23] = 0;
    } else {
      data[20] = g.cx;
      data[21] = g.cy;
      data[22] = g.radius;
      data[23] = 0;
    }

    // size @ floats 24..27
    data[24] = params.width;
    data[25] = params.height;
    data[26] = 0;
    data[27] = 0;

    // Stop colors @ offsets 28..43 (4 floats each, 4 stops).
    for (let i = 0; i < 4; i++) {
      const stop = stops[i] ?? stops[stops.length - 1]!; // pad with last stop
      const base = 28 + i * 4;
      data[base] = stop.color[0];
      data[base + 1] = stop.color[1];
      data[base + 2] = stop.color[2];
      data[base + 3] = stop.color[3];
    }

    // Stop offsets @ floats 44..47.
    for (let i = 0; i < 4; i++) {
      const stop = stops[i];
      data[44 + i] = stop ? stop.offset : 1;
    }

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 192);

    const bindGroup = this.device.createBindGroup({
      layout: this.gradientBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.gradientPipeline, 'gradient', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawTexturedQuad(params: TexturedQuadDrawParams): void {
    if (!this.passEncoder) return;
    if (params.lit) {
      this.drawLitTexturedQuad(params);
      return;
    }
    const surfaceC = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surfaceC.width, surfaceC.height, false)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surfaceC.width, surfaceC.height, params.skewX ?? 0, params.skewY ?? 0,
        );
    const uvRect = params.uvRect ?? [0, 0, 1, 1];
    const tint = params.tint ?? [1, 1, 1, 1];
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));

    // 128-byte layout matching TEXTURED_SHADER TexturedUniforms:
    //   0..15   transform
    //   16..19  uvRect
    //   20..23  tint
    //   24      cornerRadius
    //   25      alphaGamma
    //   26..27  size (w, h)
    //   28..31  _pad1
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(uvRect, 16);
    data.set(tint, 20);
    data[24] = cornerRadius;
    data[25] = params.alphaGamma ?? 1;
    data[26] = params.width;
    data[27] = params.height;
    data[28] = 0; data[29] = 0; data[30] = 0; data[31] = 0;

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 128);

    const t = params.texture as WebGPUTexture;
    const bindGroup = this.device.createBindGroup({
      layout: this.texturedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: t.view },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.texturedPipeline, 'textured', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawMaskedQuad(params: MaskedQuadDrawParams): void {
    if (!this.passEncoder) return;
    const surface = this.currentSurface();
    const transform = params.transform
      ? projectPixelMatrix(params.transform, surface.width, surface.height, false)
      : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height,
        );
    const tint = params.tint ?? [1, 1, 1, 1];
    const mode =
      params.mode === 'alpha' ? 0 :
      params.mode === 'alpha-inverted' ? 1 :
      params.mode === 'luma' ? 2 : 3;

    // 96-byte layout matching MASKED_SHADER MaskedUniforms:
    //   0..15  transform
    //   16..19 tint
    //   20     mode
    //   21..23 padding
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(tint, 16);
    data[20] = mode;
    data[21] = 0; data[22] = 0; data[23] = 0;

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 96);

    const content = params.content as WebGPUTexture;
    const mask = params.mask as WebGPUTexture;
    const bindGroup = this.device.createBindGroup({
      layout: this.maskedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: content.view },
        { binding: 3, resource: mask.view },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.maskedPipeline, 'masked', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawBackdropBlend(params: BackdropBlendDrawParams): void {
    if (!this.passEncoder) return;
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.width / 2, params.height / 2, params.width, params.height, 0,
      surface.width, surface.height,
    );
    const mode = params.mode === 'overlay' ? 0 : params.mode === 'hard-light' ? 1 : 2;

    // 80-byte layout matching BBUniforms: transform[0..15], mode[16],
    // backdropFlipY[17], pad[18..19].
    const data = this.uniformScratch;
    data.set(transform, 0);
    data[16] = mode;
    data[17] = params.backdropFlipY ? 1 : 0;
    data[18] = 0; data[19] = 0;

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 80);

    const src = params.src as WebGPUTexture;
    const backdrop = params.backdrop as WebGPUTexture;
    const bindGroup = this.device.createBindGroup({
      layout: this.maskedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: src.view },
        { binding: 3, resource: backdrop.view },
      ],
    });

    this.passEncoder.setPipeline(this.backdropBlendPipeline);
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawFilteredQuad(params: FilteredQuadDrawParams): void {
    if (!this.passEncoder) return;
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height,
    );
    const tint = params.tint ?? [1, 1, 1, 1];
    const t = params.texture as WebGPUTexture;
    // blurRadius is logical px; texture dims are physical, so σ scales
    // by the pixel ratio and texel offsets divide by physical dims.
    const sigma = params.blurRadius * this.pixelRatio;

    // 128-byte layout matching FILTERED_SHADER FilteredUniforms:
    //   0..15   transform
    //   16..19  tint
    //   20..21  texel
    //   22      sigma
    //   23      _pad0
    //   24..27  colorOps (brightness, contrast, saturation, hue radians)
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(tint, 16);
    data[20] = params.blurDir[0] / t.width;
    data[21] = params.blurDir[1] / t.height;
    data[22] = sigma;
    data[23] = 0;
    data[24] = params.brightness;
    data[25] = params.contrast;
    data[26] = params.saturation;
    data[27] = ((params.hueRotate ?? 0) * Math.PI) / 180;
    data[28] = 0; data[29] = 0; data[30] = 0; data[31] = 0;

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 128);

    const bindGroup = this.device.createBindGroup({
      layout: this.texturedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: t.view },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.filteredPipeline, 'filtered', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawStylizedQuad(params: StylizedQuadDrawParams): void {
    if (!this.passEncoder) return;
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height,
    );
    const tint = params.tint ?? [1, 1, 1, 1];
    const t = params.texture as WebGPUTexture;
    const aux = (params.aux ?? params.texture) as WebGPUTexture;
    // px-dimensioned params scale to PHYSICAL pixels; counts/angles/
    // intensities don't.
    const p0Px = params.mode !== 'dither' && params.mode !== 'glow'
      && params.mode !== 'chroma_key' && params.mode !== 'luma_key'
      && params.mode !== 'levels' && params.mode !== 'lut';
    const p1Px = params.mode === 'drop_shadow' || params.mode === 'turbulent_displace';
    const p0 = p0Px ? params.p0 * this.pixelRatio : params.p0;
    const p1 = p1Px ? (params.p1 ?? 0) * this.pixelRatio : (params.p1 ?? 0);
    const modeIdx = STYLIZE_MODE_INDEX[params.mode];

    // 112-byte layout matching STYLIZED_SHADER StylizedUniforms:
    //   0..15   transform
    //   16..19  tint
    //   20..21  texSize
    //   22      mode
    //   23      p0
    //   24      p1
    //   25..27  padding
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(tint, 16);
    data[20] = t.width;
    data[21] = t.height;
    data[22] = modeIdx;
    data[23] = p0;
    data[24] = p1;
    data[25] = this.pixelRatio; data[26] = 0; data[27] = 0;  // pixelRatio @ offset 100

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, 112);

    const bindGroup = this.device.createBindGroup({
      layout: this.maskedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: t.view },
        { binding: 3, resource: aux.view },
      ],
    });

    this.passEncoder.setPipeline(this.pipelineFor(this.stylizedPipeline, 'stylized', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  drawGlassQuad(params: GlassQuadDrawParams): void {
    if (!this.passEncoder) return;
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height,
    );
    const backdrop = params.backdrop as WebGPUTexture;
    const sharp = params.backdropSharp as WebGPUTexture;
    const pr = this.pixelRatio;
    const rad = (params.rotation * Math.PI) / 180;

    // 176-byte layout matching GLASS_SHADER GlassUniforms.
    const data = this.uniformScratch;
    data.set(transform, 0);
    data.set(params.tint, 16);
    // Surface dims, NOT the frosted texture's — the blur ladder
    // downsamples it; normalized UVs sample it fine either way.
    data[20] = surface.width * pr;
    data[21] = surface.height * pr;
    data[22] = params.paneCx * pr;
    data[23] = params.paneCy * pr;
    data[24] = params.paneHalfW * pr;
    data[25] = params.paneHalfH * pr;
    data[26] = Math.cos(rad);
    data[27] = Math.sin(rad);
    data[28] = params.cornerRadius * pr;
    data[29] = params.zRadius * pr;
    data[30] = params.bevelMode;
    data[31] = params.backdropFlipY ? 1 : 0;
    data[32] = params.refract;
    data[33] = params.chroma;
    data[34] = params.edgeHighlight;
    data[35] = params.fresnel;
    data[36] = params.specular;
    data[37] = params.saturation;
    data[38] = params.alpha;
    data[39] = 0;
    data[40] = params.shadowAlpha;
    data[41] = params.shadowSpread * pr;
    data[42] = params.shadowOffY * pr;
    data[43] = 0;

    // CKP/1.0 glass under 3D (§4.7): a pane homography selects the
    // lazily-created projective variant. A singular homography is the
    // edge-on degenerate case — the pane is invisible, draw nothing.
    let projective = false;
    if (params.paneHomography) {
      const h = homographyToPhysical(params.paneHomography, pr);
      const hinv = invertHomography(h);
      if (!hinv) return;
      projective = true;
      for (let c = 0; c < 3; c++) {
        data[44 + c * 4] = h[c * 3]!;
        data[45 + c * 4] = h[c * 3 + 1]!;
        data[46 + c * 4] = h[c * 3 + 2]!;
        data[47 + c * 4] = 0;
        data[56 + c * 4] = hinv[c * 3]!;
        data[57 + c * 4] = hinv[c * 3 + 1]!;
        data[58 + c * 4] = hinv[c * 3 + 2]!;
        data[59 + c * 4] = 0;
      }
      if (!this.glass3dPipeline) {
        const module = this.device.createShaderModule({
          code: glassShaderSource(true), label: 'glass3d',
        });
        this.glass3dPipeline = this.makeBlendablePipeline('glass3d', module, this.maskedBindGroupLayout);
      }
    }

    const buffer = this.acquireUniformBuffer();
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, projective ? 272 : 176);

    const bindGroup = this.device.createBindGroup({
      layout: this.maskedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: backdrop.view },
        { binding: 3, resource: sharp.view },
      ],
    });

    this.passEncoder.setPipeline(projective
      ? this.pipelineFor(this.glass3dPipeline!, 'glass3d', params.blend)
      : this.pipelineFor(this.glassPipeline, 'glass', params.blend));
    this.passEncoder.setBindGroup(0, bindGroup);
    this.passEncoder.draw(6, 1, 0, 0);
  }

  copySurfaceTo(target: RenderTarget): { flippedY: boolean } {
    if (!this.commandEncoder) return { flippedY: false };
    if (!this.renderTargets.has(target)) {
      getLogger().warn('copySurfaceTo with unknown / destroyed target — ignored');
      return { flippedY: false };
    }
    const top = this.surfaceStack[this.surfaceStack.length - 1];
    const srcTexture = top ? top.texture : this.canvasTexture;
    const srcView = top ? top.view : this.canvasView;
    if (!srcTexture || !srcView) return { flippedY: false };
    const dst = target.texture as WebGPUTexture;

    // Texture copies can't be recorded inside a render pass — end the
    // current pass, copy, and resume on the same surface (loadOp
    // 'load' preserves everything drawn so far).
    this.passEncoder?.end();
    this.passEncoder = null;
    this.commandEncoder.copyTextureToTexture(
      { texture: srcTexture },
      { texture: dst.gpuTexture },
      {
        width: Math.min(srcTexture.width, dst.gpuTexture.width),
        height: Math.min(srcTexture.height, dst.gpuTexture.height),
      },
    );
    this.restartPass(srcView, 'load');
    // WebGPU textures are top-down everywhere — never flipped.
    return { flippedY: false };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  async finish(): Promise<void> {
    await this.device.queue.onSubmittedWorkDone();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
    this.commandEncoder = null;
    for (const t of this.liveTextures) t.gpuTexture.destroy();
    this.liveTextures.clear();
    for (const buf of this.uniformBufferPool) buf.destroy();
    this.uniformBufferPool.length = 0;
    // Vertex buffer + pipelines + sampler are released when the device is GC'd.
    // We don't explicitly destroy() them because GPUBuffer.destroy() exists
    // but pipelines/samplers don't have an explicit destroy.
    if (this.vertexBuffer) this.vertexBuffer.destroy();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const PREMUL_BLEND: GPUBlendState = {
  // Source is premultiplied: out = src + dst * (1 - src.a).
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

// Overwrite the target: out = src. The backdrop-blend shader emits the
// full composite (incl. backdrop where the element is transparent), so
// the existing destination must be replaced, not blended into.
const REPLACE_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
};

// Non-normal blend modes, fixed-function over premultiplied sources.
// Alpha channel always composites normally so coverage stays correct;
// only the color math changes. Must match the WebGL backend's
// applyBlend() factors exactly — preview and export run different
// backends and the protocol demands identical pixels.
const PREMUL_ALPHA: GPUBlendComponent = {
  srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add',
};
const BLEND_STATES: Record<'multiply' | 'screen' | 'add', GPUBlendState> = {
  // out = src + dst (linear dodge); transparent source pixels add 0.
  add: {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: PREMUL_ALPHA,
  },
  // out = src * dst + dst * (1 - src.a) — darkens; white is neutral,
  // and uncovered (alpha 0) source pixels leave the destination alone.
  multiply: {
    color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: PREMUL_ALPHA,
  },
  // out = src + dst * (1 - src) — lightens; black is neutral.
  screen: {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' },
    alpha: PREMUL_ALPHA,
  },
};

function sourceDimensions(source: TextureSource): { width: number; height: number } {
  if ('codedWidth' in source && 'codedHeight' in source) {
    // VideoFrame
    return { width: source.codedWidth, height: source.codedHeight };
  }
  if ('videoWidth' in source && 'videoHeight' in source) {
    // HTMLVideoElement
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ('naturalWidth' in source && 'naturalHeight' in source) {
    // HTMLImageElement
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  // ImageBitmap / HTMLCanvasElement / OffscreenCanvas
  return { width: source.width, height: source.height };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
