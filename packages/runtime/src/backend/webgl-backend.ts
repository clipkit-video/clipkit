// WebGL2 implementation of the Backend interface.
//
// Same shape as the WebGPU backend (deliberately) so the runtime can swap
// between them transparently. WebGL2 + GLSL ES 3.0 shaders, premultiplied
// alpha throughout, shared unit-quad VBO, individual uniforms (no UBOs —
// simpler and our uniform set is small).
//
// Premultiplied alpha discipline:
//   - Source is configured with `premultipliedAlpha: true`
//   - Blend func: ONE / ONE_MINUS_SRC_ALPHA (premultiplied)
//   - Texture upload uses UNPACK_PREMULTIPLY_ALPHA_WEBGL
//   - Shaders assume premultiplied input

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
  StylizedQuadDrawParams,
  RenderTarget,
  ShapeDrawParams,
  LitParams,
  ShapeShadowDrawParams,
  Texture,
  TextureSource,
  TexturedQuadDrawParams,
} from './backend.js';

interface WebGLTexture_ extends Texture {
  readonly handle: WebGLTexture;
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const SHAPE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
uniform mat4 u_transform;
void main() {
  gl_Position = u_transform * vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

// Shadow pipeline: draw a quad sized to the shape PLUS blur padding,
// then in the fragment shader compute the signed distance from each
// pixel to the un-padded shape and fade alpha to 0 over `blur` pixels.
// Pixels inside the shape's SDF (negative distance) get full shadow
// alpha — the companion shape draw paints over them after.
const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec4 u_color;          // shadow color, premultiplied
uniform float u_blur;          // PIXELS; falloff distance past edge
uniform float u_cornerRadius;  // PIXELS, of the SHAPE (not quad)
uniform float u_shapeType;     // 0.0 rect, 1.0 ellipse
uniform vec2 u_size;           // pixel (width, height) of the SHAPE
uniform vec2 u_quadSize;       // pixel (width, height) of the rendered quad
void main() {
  // Pixel position in quad-local space. The shape sits centered, with
  // blur-sized margins on every side, so subtracting half the quad's
  // size and adding half the shape's size positions us in shape-local
  // coords for the SDF calculation.
  vec2 p = v_uv * u_quadSize;
  vec2 shapeHalf = u_size * 0.5;
  vec2 quadHalf = u_quadSize * 0.5;
  vec2 ps = p - quadHalf + shapeHalf;  // pixel position in SHAPE's local frame
  float dist;
  if (u_shapeType > 0.5) {
    vec2 d = (ps - shapeHalf) / shapeHalf;
    dist = (sqrt(dot(d, d)) - 1.0) * min(shapeHalf.x, shapeHalf.y);
  } else {
    float r = u_cornerRadius;
    vec2 q = abs(ps - shapeHalf) - shapeHalf + vec2(r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
  }
  // CSS box-shadow is a Gaussian BLUR of an offset shape, not a
  // hard-edge falloff: alpha is ~1.0 deep inside the shape, ~0.5
  // right at the edge, and tails to 0 about u_blur pixels past the
  // edge. Symmetric smoothstep approximates the erfc shape closely
  // enough — without it the shape-edge alpha is 1.0 instead of 0.5,
  // making shadows look much darker and extend further than CSS.
  if (dist > u_blur) discard;
  float alpha = 1.0 - smoothstep(-u_blur, u_blur, dist);
  if (alpha < 0.001) discard;
  fragColor = u_color * alpha;
}
`;

const SHAPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec4 u_color;          // fill, premultiplied
uniform vec4 u_strokeColor;    // stroke, premultiplied
uniform float u_strokeWidth;   // PIXELS; 0 disables stroke
uniform float u_cornerRadius;  // PIXELS
uniform float u_shapeType;     // 0.0 rect, 1.0 ellipse
uniform vec2 u_size;           // pixel (width, height)
void main() {
  // Signed pixel distance from the shape boundary: negative inside,
  // positive outside. Used both to discard outside pixels and to
  // decide whether a pixel falls in the stroke band (boundary-side
  // strokeWidth pixels deep).
  vec2 p = v_uv * u_size;
  vec2 half_ = u_size * 0.5;
  float dist;
  if (u_shapeType > 0.5) {
    // Ellipse — exact pixel SDF is hard; use a normalized-space
    // approximation scaled by the smaller half-axis. Exact for
    // circles; underestimates the boundary distance for elongated
    // ellipses, which means the stroke band reads slightly thin near
    // the long-axis ends. Good enough for icon-shaped uses.
    vec2 d = (p - half_) / half_;
    dist = (sqrt(dot(d, d)) - 1.0) * min(half_.x, half_.y);
  } else {
    // Rectangle / rounded rectangle. r = 0 collapses to a sharp rect.
    float r = u_cornerRadius;
    vec2 q = abs(p - half_) - half_ + vec2(r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
  }
  // Anti-aliased boundary: use screen-space derivative to find the
  // AA band around dist = 0, and blend out as we exit the shape.
  // Without this, rotated rectangles show jagged stairstep edges
  // (the rotated geometry no longer aligns with pixel rows). Band
  // width = 2 × fwidth(dist) — wider than the standard 1 px so edges
  // stay visibly smooth even when the canvas is downsampled to a
  // smaller preview or the display has higher pixel density than the
  // canvas backing store.
  float aa = fwidth(dist);
  float outerAlpha = 1.0 - smoothstep(-aa, aa, dist);
  if (outerAlpha < 0.001) discard;

  vec4 base;
  if (u_strokeWidth > 0.0) {
    // Stroke band is the [-strokeWidth, 0] interval of dist; the fill
    // interior is dist <= -strokeWidth. strokeAlpha rises from 0 (fill)
    // to 1 (stroke) as dist crosses -strokeWidth, with the same ~1px
    // AA softness applied at the inner boundary so the stroke doesn't
    // stair-step against the fill.
    float strokeAlpha = smoothstep(-u_strokeWidth - aa, -u_strokeWidth + aa, dist);
    base = mix(u_color, u_strokeColor, strokeAlpha);
  } else {
    base = u_color;
  }
  // Premultiplied output: scaling all channels by outerAlpha is correct.
  fragColor = base * outerAlpha;
}
`;

// ── Lit shape path (CKP/1.0 §4.8 PBR) ───────────────────────────────────────
// Same SDF as SHAPE_FS, but the fill is shaded: Lambert diffuse + GGX
// specular + Schlick Fresnel from directional lights, in WORLD space, so
// the highlight is view-dependent and sweeps as the camera moves. Albedo
// is the shape's straight-alpha fill. u_worldMatrix maps the unit quad to
// world (pre-camera) for the per-fragment position; u_transform still maps
// to clip.
const LIT_SHAPE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
out vec3 v_worldPos;
uniform mat4 u_transform;
uniform mat4 u_worldMatrix;
void main() {
  gl_Position = u_transform * vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  vec4 wp = u_worldMatrix * vec4(a_pos, 0.0, 1.0);
  v_worldPos = wp.xyz;
}
`;

// Shared PBR fragment library (§4.8): common uniforms + helpers +
// shadePBR(albedo, N, V). Concatenated into BOTH the lit-shape and
// lit-textured fragment shaders so the lighting math can never diverge
// between vector and textured surfaces. Must stay math-identical to the
// WGSL pbrLibWGSL() in the WebGPU backend.
const PBR_FS_LIB = `
uniform vec3 u_normal;
uniform vec3 u_eye;
uniform float u_rough;
uniform float u_metal;
uniform float u_reflect;
uniform float u_emissive;
uniform vec3 u_ambient;
uniform int u_numLights;
uniform vec3 u_lightDir[4];
uniform vec3 u_lightColor[4];
uniform int u_envCount;            // 0 ⇒ no environment reflection
uniform vec3 u_envColor[4];        // straight RGB, sorted by offset
uniform float u_envOffset[4];
uniform vec3 u_envAvg;             // mean env color (irradiance / rough fallback)
uniform vec3 u_tangent;            // world +U (normal mapping)
uniform vec3 u_bitangent;          // world +V
uniform float u_normalScale;
uniform int u_hasNormalMap;        // 0 ⇒ flat face normal
uniform sampler2D u_normalMap;
uniform int u_envIsImage;          // 1 ⇒ sample u_envMap as equirect
uniform sampler2D u_envMap;
const float PI = 3.14159265;
float ggxD(float NdotH, float a) { float a2 = a * a; float d = NdotH * NdotH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float gSchlick(float x, float k) { return x / (x * (1.0 - k) + k); }
// Sample the gradient environment at parameter t∈[0,1] (const-indexed for
// portability — matches the WGSL path). Stops are sorted by offset.
vec3 sampleEnv(float t) {
  vec3 c = u_envColor[0];
  if (u_envCount > 1) {
    vec3 last = u_envColor[1];
    if (u_envCount > 2) last = u_envColor[2];
    if (u_envCount > 3) last = u_envColor[3];
    if (t <= u_envOffset[1]) {
      c = mix(u_envColor[0], u_envColor[1], clamp((t - u_envOffset[0]) / max(u_envOffset[1] - u_envOffset[0], 1e-4), 0.0, 1.0));
    } else if (u_envCount > 2 && t <= u_envOffset[2]) {
      c = mix(u_envColor[1], u_envColor[2], clamp((t - u_envOffset[1]) / max(u_envOffset[2] - u_envOffset[1], 1e-4), 0.0, 1.0));
    } else if (u_envCount > 3 && t <= u_envOffset[3]) {
      c = mix(u_envColor[2], u_envColor[3], clamp((t - u_envOffset[2]) / max(u_envOffset[3] - u_envOffset[2], 1e-4), 0.0, 1.0));
    } else {
      c = last;
    }
  }
  return c;
}
// Perturb the face normal by a tangent-space normal map (flat = #8080ff).
vec3 perturbNormal(vec3 N, vec2 uv) {
  if (u_hasNormalMap == 0) return N;
  vec3 s = texture(u_normalMap, uv).rgb * 2.0 - 1.0;
  s.xy *= u_normalScale;
  return normalize(s.x * normalize(u_tangent) + s.y * normalize(u_bitangent) + s.z * N);
}
// Shade a fragment given its straight-alpha albedo, world normal, view
// vector. Returns clamped straight RGB (ambient + direct + env + emissive).
vec3 shadePBR(vec3 albedo, vec3 Nin, vec3 V) {
  vec3 N = Nin;
  if (dot(N, V) < 0.0) N = -N;          // two-sided
  float NdotV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.04), albedo, u_metal);
  float a = u_rough * u_rough;
  float k = (u_rough + 1.0) * (u_rough + 1.0) / 8.0;

  vec3 color = albedo * u_ambient;       // ambient (flat fill) term
  for (int i = 0; i < 4; i++) {
    if (i >= u_numLights) break;
    vec3 L = normalize(u_lightDir[i]);
    vec3 H = normalize(V + L);
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
    float D = ggxD(NdotH, a);
    float G = gSchlick(NdotL, k) * gSchlick(NdotV, k);
    vec3 spec = (D * G) * F / max(4.0 * NdotL * NdotV, 1e-3);
    vec3 kd = (1.0 - F) * (1.0 - u_metal);
    color += (kd * albedo + spec) * u_lightColor[i] * NdotL;
  }
  // Environment reflection: mirror the gradient sky along R, roughness-
  // blurred toward the average; IBL split (diffuse + Fresnel specular).
  if (u_envCount > 0 || u_envIsImage == 1) {
    vec3 R = reflect(-V, N);
    vec3 sharp;
    if (u_envIsImage == 1) {
      // Equirect (lat-long) sample along the reflection ray. Up = −y.
      vec3 Rn = normalize(R);
      vec2 euv = vec2(atan(Rn.x, Rn.z) / (2.0 * PI) + 0.5, acos(clamp(-Rn.y, -1.0, 1.0)) / PI);
      sharp = texture(u_envMap, euv).rgb;
    } else {
      float t = clamp(0.5 - 0.5 * (R.y / max(length(R), 1e-4)), 0.0, 1.0); // up→1, down→0
      sharp = sampleEnv(t);
    }
    vec3 envc = mix(sharp, u_envAvg, u_rough);
    vec3 Fr = F0 + (max(vec3(1.0 - u_rough), F0) - F0) * pow(1.0 - NdotV, 5.0);
    vec3 kdEnv = (1.0 - Fr) * (1.0 - u_metal);
    color += (kdEnv * albedo * u_envAvg + envc * Fr) * u_reflect;
  }
  color = mix(color, albedo, clamp(u_emissive, 0.0, 1.0));
  return clamp(color, 0.0, 1.0);
}
`;

const LIT_SHAPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_worldPos;
out vec4 fragColor;
uniform vec4 u_albedo;         // straight (non-premultiplied)
uniform vec4 u_strokeAlbedo;   // straight
uniform float u_strokeWidth;
uniform float u_cornerRadius;
uniform float u_shapeType;
uniform vec2 u_size;
${PBR_FS_LIB}
void main() {
  vec2 p = v_uv * u_size;
  vec2 half_ = u_size * 0.5;
  float dist;
  if (u_shapeType > 0.5) {
    vec2 d = (p - half_) / half_;
    dist = (sqrt(dot(d, d)) - 1.0) * min(half_.x, half_.y);
  } else {
    float r = u_cornerRadius;
    vec2 q = abs(p - half_) - half_ + vec2(r);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
  }
  float aa = fwidth(dist);
  float outerAlpha = 1.0 - smoothstep(-aa, aa, dist);
  if (outerAlpha < 0.001) discard;

  vec4 alb = u_albedo;
  if (u_strokeWidth > 0.0) {
    float sa = smoothstep(-u_strokeWidth - aa, -u_strokeWidth + aa, dist);
    alb = mix(u_albedo, u_strokeAlbedo, sa);
  }
  vec3 N = perturbNormal(normalize(u_normal), v_uv);
  vec3 color = shadePBR(alb.rgb, N, normalize(u_eye - v_worldPos));
  float outA = alb.a * outerAlpha;
  fragColor = vec4(color * outA, outA);  // premultiplied
}`;

// Lit textured quad (§4.8): images, video, and flattened group-card
// layers shaded as one surface. Albedo = the texture's own (straight)
// pixels; same shadePBR as shapes.
const LIT_TEXTURED_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
out vec2 v_quadPos;
out vec3 v_worldPos;
uniform mat4 u_transform;
uniform mat4 u_worldMatrix;
uniform vec4 u_uvRect; // (u0, v0, u1, v1)
void main() {
  gl_Position = u_transform * vec4(a_pos, 0.0, 1.0);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);
  v_quadPos = a_uv;
  vec4 wp = u_worldMatrix * vec4(a_pos, 0.0, 1.0);
  v_worldPos = wp.xyz;
}`;

const LIT_TEXTURED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_quadPos;
in vec3 v_worldPos;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec4 u_tint;           // premultiplied
uniform float u_cornerRadius;  // PIXELS; 0 disables masking
uniform vec2 u_size;           // pixel (width, height) of the quad
${PBR_FS_LIB}
void main() {
  vec4 s = texture(u_tex, v_uv);   // premultiplied
  float cov = s.a;
  vec3 albedo = cov > 0.0 ? s.rgb / cov : s.rgb;   // straight albedo
  // tint as straight color × opacity (group layers pass (o,o,o,o)).
  vec3 tintRgb = u_tint.a > 0.0 ? u_tint.rgb / u_tint.a : vec3(1.0);
  albedo *= tintRgb;

  float maskAlpha = 1.0;
  if (u_cornerRadius > 0.0) {
    vec2 p = v_quadPos * u_size;
    vec2 half_ = u_size * 0.5;
    float r = u_cornerRadius;
    vec2 q = abs(p - half_) - half_ + vec2(r);
    float dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
    float aa = fwidth(dist);
    maskAlpha = 1.0 - smoothstep(-aa, aa, dist);
    if (maskAlpha < 0.001) discard;
  }
  vec3 N = perturbNormal(normalize(u_normal), v_quadPos);
  vec3 color = shadePBR(albedo, N, normalize(u_eye - v_worldPos));
  float outA = cov * u_tint.a * maskAlpha;
  fragColor = vec4(color * outA, outA);  // premultiplied
}`;

// Gradient pipeline: shape filled with a linear or radial gradient.
const GRADIENT_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
uniform mat4 u_transform;
void main() {
  gl_Position = u_transform * vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const GRADIENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec4 u_meta;          // cornerRadius (PIXELS), shapeType, fillType, numStops
uniform vec4 u_params;        // linear:(cos,sin,_,_) | radial:(cx,cy,radius,_)
uniform vec2 u_size;          // pixel (width, height)
uniform vec4 u_stops[4];      // 4 stop colors (premultiplied)
uniform vec4 u_stopOffsets;   // 4 stop offsets

void main() {
  vec2 uv = v_uv;
  float cornerRadius = u_meta.x;
  float shapeType = u_meta.y;
  float fillType = u_meta.z;
  int nStops = int(u_meta.w);

  // Shape masking — SDF in pixel space (corners stay circular).
  vec2 p_px = uv * u_size;
  vec2 half_ = u_size * 0.5;
  if (shapeType > 0.5) {
    vec2 d = (p_px - half_) / half_;
    if (dot(d, d) > 1.0) discard;
  } else if (cornerRadius > 0.0) {
    float r = cornerRadius;
    vec2 q = abs(p_px - half_) - (half_ - vec2(r));
    vec2 outside = max(q, vec2(0.0));
    if (length(outside) > r) discard;
  }

  // Gradient parameter t — runs in UV space (gradient directions are
  // relative to the shape's normalized bounding box).
  float t;
  if (fillType > 0.5) {
    float radius = max(u_params.z, 0.0001);
    t = clamp(distance(uv, u_params.xy) / radius, 0.0, 1.0);
  } else {
    vec2 dir = u_params.xy;
    vec2 centered = uv - vec2(0.5);
    t = clamp(dot(centered, dir) + 0.5, 0.0, 1.0);
  }

  vec4 color = u_stops[0];
  for (int i = 0; i < 3; i++) {
    if (i >= nStops - 1) break;
    float off0 = u_stopOffsets[i];
    float off1 = u_stopOffsets[i + 1];
    if (t >= off0 && t <= off1) {
      float segT = (t - off0) / max(off1 - off0, 0.0001);
      color = mix(u_stops[i], u_stops[i + 1], segT);
      break;
    }
  }
  if (t >= u_stopOffsets[nStops - 1]) {
    color = u_stops[nStops - 1];
  }

  fragColor = color;
}
`;

const TEXTURED_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
out vec2 v_quadPos;
uniform mat4 u_transform;
uniform vec4 u_uvRect; // (u0, v0, u1, v1)
void main() {
  gl_Position = u_transform * vec4(a_pos, 0.0, 1.0);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);
  v_quadPos = a_uv;
}
`;

const TEXTURED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_quadPos;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec4 u_tint;           // premultiplied
uniform float u_cornerRadius;  // PIXELS; 0 disables masking
uniform vec2 u_size;           // pixel (width, height) of the quad
uniform float u_alphaGamma;    // coverage exponent; 1 = no-op (see backend.ts)
void main() {
  vec4 s = texture(u_tex, v_uv);   // already premultiplied (UNPACK_PREMULTIPLY_ALPHA_WEBGL)
  if (u_alphaGamma != 1.0) {
    // Reshape coverage: a' = a^g. Premultiplied, so scale the whole
    // sample by a^(g-1); the max() guard keeps g<1 finite at a=0.
    s *= pow(max(s.a, 1e-5), u_alphaGamma - 1.0);
  }
  float maskAlpha = 1.0;
  if (u_cornerRadius > 0.0) {
    // Same rounded-rect SDF as SHAPE_FS, evaluated in the quad's
    // local pixel space (v_quadPos is the un-remapped 0..1 vertex
    // attribute, not the sampling UV).
    vec2 p = v_quadPos * u_size;
    vec2 half_ = u_size * 0.5;
    float r = u_cornerRadius;
    vec2 q = abs(p - half_) - half_ + vec2(r);
    float dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
    float aa = fwidth(dist);
    maskAlpha = 1.0 - smoothstep(-aa, aa, dist);
    if (maskAlpha < 0.001) discard;
  }
  fragColor = s * u_tint * maskAlpha;
}
`;

// Masked composite: content sampled through a second texture's alpha or
// luminance. Shares TEXTURED_VS. Both textures are premultiplied; the
// whole premultiplied content color scales by the mask factor, which is
// the correct premultiplied masking operation.
const MASKED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_quadPos;
out vec4 fragColor;
uniform sampler2D u_tex;   // content (premultiplied)
uniform sampler2D u_mask;  // mask (premultiplied)
uniform vec4 u_tint;       // premultiplied
uniform float u_mode;      // 0 alpha, 1 alpha-inverted, 2 luma, 3 luma-inverted
void main() {
  vec4 c = texture(u_tex, v_uv) * u_tint;
  vec4 m = texture(u_mask, v_uv);
  float f;
  if (u_mode < 0.5) f = m.a;
  else if (u_mode < 1.5) f = 1.0 - m.a;
  else {
    float luma = dot(m.rgb, vec3(0.2126, 0.7152, 0.0722));
    f = (u_mode < 2.5) ? luma : (1.0 - luma);
  }
  fragColor = c * f;
}
`;

// Backdrop-blend composite (§4.5): piecewise blend modes that can't be
// fixed-function. Reads the isolated element layer (u_src) and a
// backdrop snapshot (u_backdrop), both premultiplied + surface-sized,
// runs the W3C separable composite, and REPLACES the target (caller
// sets blendFunc to ONE,ZERO). Where the element is transparent the
// output equals the backdrop, so replacing is a no-op there.
const BACKDROP_BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;        // element layer, premultiplied
uniform sampler2D u_backdrop;   // backdrop snapshot, premultiplied
uniform int u_mode;             // 0 overlay, 1 hard-light, 2 soft-light
uniform float u_backdropFlipY;  // 1.0 flips backdrop v
float blendCh(int mode, float cb, float cs) {
  if (mode == 0) {            // overlay
    return cb <= 0.5 ? (2.0*cb*cs) : (1.0 - 2.0*(1.0-cb)*(1.0-cs));
  } else if (mode == 1) {     // hard-light = overlay(src,backdrop)
    return cs <= 0.5 ? (2.0*cs*cb) : (1.0 - 2.0*(1.0-cs)*(1.0-cb));
  } else {                    // soft-light (W3C)
    if (cs <= 0.5) return cb - (1.0 - 2.0*cs) * cb * (1.0 - cb);
    float d = cb <= 0.25 ? (((16.0*cb - 12.0)*cb + 4.0)*cb) : sqrt(cb);
    return cb + (2.0*cs - 1.0) * (d - cb);
  }
}
void main() {
  vec4 s = texture(u_src, v_uv);
  vec2 buv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_backdropFlipY));
  vec4 b = texture(u_backdrop, buv);
  float as = s.a, ab = b.a;
  vec3 Cs = as > 0.0 ? s.rgb / as : vec3(0.0);
  vec3 Cb = ab > 0.0 ? b.rgb / ab : vec3(0.0);
  vec3 Bc = vec3(blendCh(u_mode, Cb.r, Cs.r), blendCh(u_mode, Cb.g, Cs.g), blendCh(u_mode, Cb.b, Cs.b));
  vec3 co = as*(1.0-ab)*Cs + as*ab*Bc + (1.0-as)*ab*Cb;  // premultiplied
  float ao = as + ab*(1.0-as);
  fragColor = vec4(co, ao);
}
`;

// Filter composite: a layer texture drawn 1:1 with an optional separable
// Gaussian blur pass plus color ops. Shares TEXTURED_VS. 25 taps spread
// over ±3σ; weights computed in-shader and normalized by their sum so
// edge-clamped taps don't darken. Color ops run on STRAIGHT alpha
// (unpremultiply → brightness → contrast → saturation → re-premultiply);
// premultiplied math would drag translucent pixels toward black on the
// contrast midpoint. Must match the WebGPU FILTERED_SHADER exactly.
const FILTERED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;   // layer (premultiplied)
uniform vec2 u_texel;      // blur direction ÷ texture PHYSICAL dims
uniform float u_sigma;     // Gaussian σ in PHYSICAL pixels; 0 = no blur
uniform vec4 u_colorOps;   // (brightness, contrast, saturation, hue radians)
uniform vec4 u_tint;       // premultiplied
void main() {
  vec4 acc;
  if (u_sigma > 0.0) {
    acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = -12; i <= 12; i++) {
      float d = float(i) * u_sigma * 0.25;  // taps cover ±3σ
      float w = exp(-0.5 * d * d / (u_sigma * u_sigma));
      acc += texture(u_tex, v_uv + u_texel * d) * w;
      wsum += w;
    }
    acc /= wsum;
  } else {
    acc = texture(u_tex, v_uv);
  }
  float a = acc.a;
  vec3 c = a > 0.0 ? acc.rgb / a : vec3(0.0);
  c *= u_colorOps.x;                                // brightness
  c = (c - 0.5) * u_colorOps.y + 0.5;               // contrast
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));   // Rec. 709 luma
  c = mix(vec3(l), c, u_colorOps.z);                // saturation
  if (u_colorOps.w != 0.0) {                        // hue rotate (SVG matrix)
    float hc = cos(u_colorOps.w);
    float hs = sin(u_colorOps.w);
    c = mat3(
      0.213 + 0.787*hc - 0.213*hs, 0.213 - 0.213*hc + 0.143*hs, 0.213 - 0.213*hc - 0.787*hs,
      0.715 - 0.715*hc - 0.715*hs, 0.715 + 0.285*hc + 0.140*hs, 0.715 - 0.715*hc + 0.715*hs,
      0.072 - 0.072*hc + 0.928*hs, 0.072 - 0.072*hc - 0.283*hs, 0.072 + 0.928*hc + 0.072*hs
    ) * c;
  }
  c = clamp(c, 0.0, 1.0);
  fragColor = vec4(c * a, a) * u_tint;
}
`;

// Stylize composite: one effects-array pass (§4.7) — pixelate, dither,
// halftone, or ascii — drawn 1:1 like the filter composite. Shares
// TEXTURED_VS. The mode is a uniform, so all branches are uniform
// control flow. Color math runs on STRAIGHT alpha; dot/glyph "ink"
// scales BOTH color and alpha (premultiplied output). Must match the
// WebGPU STYLIZED_SHADER exactly.
const STYLIZED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;   // layer (premultiplied)
uniform sampler2D u_aux;   // ascii glyph atlas (80×8); layer tex when unused
uniform vec2 u_texSize;    // layer PHYSICAL dims
uniform vec4 u_params;     // (mode, p0, p1, 0) — px params pre-scaled to PHYSICAL
uniform vec4 u_tint;       // premultiplied

const float BAYER[16] = float[16](
   0.,  8.,  2., 10.,
  12.,  4., 14.,  6.,
   3., 11.,  1.,  9.,
  15.,  7., 13.,  5.);

// ── Normative noise (§4.7 fractal_noise / turbulent_displace) ──
// PCG integer hash → value noise (quintic fade) → fBM (lacunarity 2,
// gain 0.5, per-octave seed+o). Integer ops are bit-exact everywhere.
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28) + 4u)) ^ s) * 277803737u;
  return (w >> 22) ^ w;
}
float h01(ivec3 c, uint seed) {
  return float(pcg(uint(c.x) ^ pcg(uint(c.y) ^ pcg(uint(c.z) ^ pcg(seed))))) / 4294967295.0;
}
float vnoise(vec3 p, uint seed) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float n000 = h01(c, seed);
  float n100 = h01(c + ivec3(1, 0, 0), seed);
  float n010 = h01(c + ivec3(0, 1, 0), seed);
  float n110 = h01(c + ivec3(1, 1, 0), seed);
  float n001 = h01(c + ivec3(0, 0, 1), seed);
  float n101 = h01(c + ivec3(1, 0, 1), seed);
  float n011 = h01(c + ivec3(0, 1, 1), seed);
  float n111 = h01(c + ivec3(1, 1, 1), seed);
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm(vec3 p, int octaves, uint seed) {
  float v = 0.0;
  float amp = 1.0;
  float wsum = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    v += amp * vnoise(p, seed + uint(o));
    wsum += amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return v / wsum;
}

void main() {
  float mode = u_params.x;
  vec2 px = v_uv * u_texSize;
  if (mode < 0.5) {
    // pixelate — every pixel takes its cell's center sample.
    float cell = max(u_params.y, 1.0);
    vec2 center = (floor(px / cell) + 0.5) * cell;
    fragColor = texture(u_tex, center / u_texSize) * u_tint;
  } else if (mode < 1.5) {
    // dither — per-channel quantize to N levels, 4×4 Bayer threshold
    // indexed by output pixel coords. Alpha (coverage) is untouched.
    vec4 s = texture(u_tex, v_uv);
    float a = s.a;
    vec3 c = a > 0.0 ? s.rgb / a : vec3(0.0);
    // Bayer cells of u_params.z (pixel_size) LOGICAL px: divide device px
    // by (pixelRatio · pixel_size). Resolution-independent — the dot size
    // is stable across preview DPI / export and survives the editor's
    // fit-to-stage downscale instead of smearing into mush.
    ivec2 ip = ivec2(px / max(u_params.w * u_params.z, 1.0));
    float t = (BAYER[(ip.y % 4) * 4 + (ip.x % 4)] + 0.5) / 16.0;
    float n = max(u_params.y, 2.0) - 1.0;
    c = clamp(floor(c * n + t) / n, 0.0, 1.0);
    fragColor = vec4(c * a, a) * u_tint;
  } else if (mode < 2.5) {
    // halftone — rotated dot grid; dot radius ∝ sqrt(luma) so ink AREA
    // tracks luminance; dots tinted with the cell's color. The
    // clamp(r,0,1) factor fades sub-pixel dots instead of popping.
    float cell = max(u_params.y, 2.0);
    float ang = radians(u_params.z);
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    mat2 inv = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
    vec2 rp = rot * px;
    vec2 centerR = (floor(rp / cell) + 0.5) * cell;
    vec4 s = texture(u_tex, (inv * centerR) / u_texSize);
    float a = s.a;
    vec3 c = a > 0.0 ? s.rgb / a : vec3(0.0);
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722)) * a;
    float r = 0.5 * cell * sqrt(luma);
    float d = length(rp - centerR);
    float ink = (1.0 - smoothstep(r - 1.0, r + 1.0, d)) * clamp(r, 0.0, 1.0);
    fragColor = vec4(c, 1.0) * (a * ink) * u_tint;
  } else if (mode < 3.5) {
    // ascii — cells map to the 10-glyph density ramp in the atlas,
    // tinted with the cell's sampled color.
    float cell = max(u_params.y, 4.0);
    vec2 cellOrigin = floor(px / cell) * cell;
    vec4 s = texture(u_tex, (cellOrigin + 0.5 * cell) / u_texSize);
    float a = s.a;
    vec3 c = a > 0.0 ? s.rgb / a : vec3(0.0);
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722)) * a;
    float idx = clamp(floor(luma * 10.0), 0.0, 9.0);
    vec2 g = clamp(floor((px - cellOrigin) / cell * 8.0), 0.0, 7.0);
    vec2 auxUv = vec2((idx * 8.0 + g.x + 0.5) / 80.0, (g.y + 0.5) / 8.0);
    float ink = texture(u_aux, auxUv).a;
    fragColor = vec4(c, 1.0) * (a * ink) * u_tint;
  } else if (mode < 4.5) {
    // drop_shadow — aux is the ladder-blurred layer; its alpha,
    // offset and tinted, composites UNDER the content (premultiplied
    // under-operator: dst × (1 − src.a)).
    vec4 c = texture(u_tex, v_uv);
    vec2 texel = 1.0 / u_texSize;
    vec2 ouv = clamp(v_uv - vec2(u_params.y, u_params.z) * texel, vec2(0.0), vec2(1.0));
    float sa = texture(u_aux, ouv).a;
    fragColor = c + u_tint * (sa * (1.0 - c.a));
  } else if (mode < 5.5) {
    // glow — blurred silhouette × intensity × color, under the content.
    vec4 c = texture(u_tex, v_uv);
    float ga = clamp(texture(u_aux, v_uv).a * u_params.y, 0.0, 1.0);
    fragColor = c + u_tint * (ga * (1.0 - c.a));
  } else if (mode < 6.5) {
    // stroke — outline band outside the silhouette: max alpha over a
    // 16-tap ring at the stroke width, under the content.
    vec4 c = texture(u_tex, v_uv);
    vec2 texel = 1.0 / u_texSize;
    float w = max(u_params.y, 1.0);
    float s = 0.0;
    for (int i = 0; i < 16; i++) {
      float ang = 6.2831853 * float(i) / 16.0;
      s = max(s, texture(u_tex, clamp(v_uv + vec2(cos(ang), sin(ang)) * w * texel, vec2(0.0), vec2(1.0))).a);
    }
    fragColor = c + u_tint * (s * (1.0 - c.a));
  } else if (mode < 7.5) {
    // chroma_key — BT.709 CbCr distance ramp (§4.7). u_tint.rgb = key
    // color (STRAIGHT), u_tint.a = spill; p0 tolerance, p1 softness.
    vec4 s = texture(u_tex, v_uv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    vec3 k = u_tint.rgb;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float cy = dot(c, LUMA);
    float ky = dot(k, LUMA);
    vec2 cc = vec2((c.b - cy) / 1.8556, (c.r - cy) / 1.5748);
    vec2 kc = vec2((k.b - ky) / 1.8556, (k.r - ky) / 1.5748);
    float d = distance(cc, kc);
    float a = u_params.z > 0.0
      ? clamp((d - u_params.y) / u_params.z, 0.0, 1.0)
      : (d > u_params.y ? 1.0 : 0.0);
    // Spill suppression: cap the key's dominant channel (ties g→r→b)
    // at the max of the other two, scaled by spill.
    if (k.g >= k.r && k.g >= k.b) c.g -= u_tint.a * max(0.0, c.g - max(c.r, c.b));
    else if (k.r >= k.b)          c.r -= u_tint.a * max(0.0, c.r - max(c.g, c.b));
    else                          c.b -= u_tint.a * max(0.0, c.b - max(c.r, c.g));
    float ao = s.a * a;
    fragColor = vec4(c * ao, ao);
  } else if (mode < 8.5) {
    // luma_key — p0 threshold, p1 softness, u_tint.r = invert flag.
    vec4 s = texture(u_tex, v_uv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float a = u_params.z > 0.0
      ? clamp((y - u_params.y) / u_params.z, 0.0, 1.0)
      : (y > u_params.y ? 1.0 : 0.0);
    if (u_tint.x > 0.5) a = 1.0 - a;
    float ao = s.a * a;
    fragColor = vec4(c * ao, ao);
  } else if (mode < 9.5) {
    // levels — per-channel remap (§4.7): u_tint = (in_black, in_white,
    // out_black, out_white), p0 = gamma; y = x^(1/gamma).
    vec4 s = texture(u_tex, v_uv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    vec3 x = clamp((c - u_tint.x) / max(u_tint.y - u_tint.x, 1e-5), 0.0, 1.0);
    x = pow(x, vec3(1.0 / max(u_params.y, 1e-5)));
    c = clamp(u_tint.z + x * (u_tint.w - u_tint.z), 0.0, 1.0);
    fragColor = vec4(c * s.a, s.a);
  } else if (mode < 10.5) {
    // lut — 3D lattice packed as N slices along x in a 2D atlas (aux,
    // N²×N, slice index = blue). Manual trilinear: two bilinear taps
    // mixed across the blue axis. p0 = N, p1 = intensity.
    vec4 s = texture(u_tex, v_uv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    float n = max(u_params.y, 2.0);
    float b = clamp(c.b, 0.0, 1.0) * (n - 1.0);
    float b0 = floor(b);
    float b1 = min(b0 + 1.0, n - 1.0);
    vec2 cellUv = vec2(
      (clamp(c.r, 0.0, 1.0) * (n - 1.0) + 0.5) / (n * n),
      (clamp(c.g, 0.0, 1.0) * (n - 1.0) + 0.5) / n);
    vec3 lo = texture(u_aux, cellUv + vec2(b0 / n, 0.0)).rgb;
    vec3 hi = texture(u_aux, cellUv + vec2(b1 / n, 0.0)).rgb;
    c = mix(c, mix(lo, hi, b - b0), clamp(u_params.z, 0.0, 1.0));
    fragColor = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
  } else if (mode < 11.5) {
    // fractal_noise — grayscale fBM over the element's footprint.
    // p0 = scale px, p1 = evolution,
    // u_tint = (offset_x/scale, offset_y/scale, octaves, seed).
    vec4 s = texture(u_tex, v_uv);
    float v = fbm(
      vec3(px / max(u_params.y, 1e-3) + u_tint.xy, u_params.z),
      int(u_tint.z + 0.5), uint(u_tint.w + 0.5));
    fragColor = vec4(vec3(v) * s.a, s.a);
  } else if (mode < 12.5) {
    // turbulent_displace — sample the layer at p + noise vector.
    // p0 = amount px, p1 = scale px, u_tint = (evolution, octaves, seed, 0).
    float sc = max(u_params.z, 1e-3);
    int oct = int(u_tint.y + 0.5);
    uint sd = uint(u_tint.z + 0.5);
    float dx = fbm(vec3(px / sc, u_tint.x), oct, sd) - 0.5;
    float dy = fbm(vec3(px / sc, u_tint.x), oct, sd + 7919u) - 0.5;
    vec2 duv = vec2(dx, dy) * 2.0 * u_params.y / u_texSize;
    fragColor = texture(u_tex, clamp(v_uv + duv, vec2(0.0), vec2(1.0)));
  } else {
    // bloom_bright — extract pixels brighter than a soft threshold for a
    // whole-frame bloom pass. p0 = threshold, p1 = knee. Output is the
    // straight bright color with alpha 1 so the subsequent blur spreads
    // it cleanly; the composite adds it back × intensity.
    vec4 s = texture(u_tex, v_uv);
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float f = clamp((l - u_params.y) / max(u_params.z, 1e-3), 0.0, 1.0);
    fragColor = vec4(c * f, 1.0);
  }
}
`;

// Glass composite (§4.7 'glass') — faithful port of the
// ybouane/liquidglass FS_GLASS shader onto our conventions (full-
// surface quad via TEXTURED_VS, premultiplied snapshot textures,
// premultiplied output). The pane geometry is ANALYTIC: rounded-rect
// SDF + half-circle bevel height field, dual-surface (biconvex)
// refraction or dome magnification, Fresnel + Blinn-Phong lighting,
// inner stroke, and an outside-only drop shadow. Must match the WebGPU
// GLASS_SHADER exactly.
//
// Two variants from one template (CKP/1.0 glass under 3D, §4.7): the
// PROJECTIVE variant maps surface px → pane-local through the inverse
// of the pane's plane homography (exact ray/plane intersection in
// projective form) and forward-maps refracted sample points back —
// everything between (SDF, bevel, refraction, light rig) runs in the
// pane's local frame and tilts with it. The non-projective source is
// byte-identical to the CKP/1.0 shader (the equivalence gate).
const glassFsSource = (projective: boolean): string => `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_backdrop;  // FROSTED snapshot (premultiplied)
uniform sampler2D u_sharp;     // UNBLURRED snapshot (premultiplied)
uniform vec2 u_texSize;        // surface PHYSICAL dims
uniform vec2 u_paneCenter;     // pane centre, PHYSICAL px
uniform vec2 u_paneHalf;       // pane half-size, PHYSICAL px
uniform vec2 u_rot;            // (cos θ, sin θ) of pane rotation
uniform vec4 u_geo;            // (cornerRadius, zRadius, bevelMode, bdFlip) PHYSICAL
uniform vec4 u_optics;         // (refract, chroma, edgeHL, fresnel)
uniform vec4 u_look;           // (specular, saturation −1..1, alpha, 0)
uniform vec4 u_shadow;         // (alpha, spread, offY, 0) PHYSICAL
uniform vec4 u_tint;           // STRAIGHT rgba — alpha = strength${projective ? `
uniform mat3 u_h;              // pane-local → surface px (projective)
uniform mat3 u_hinv;           // surface px → pane-local` : ''}

float rrSDF(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Half-circle bevel height field (reference bevelHeight).
float bevelHeight(float d, float zR) {
  if (d <= 0.0) return 0.0;
  if (d >= zR) return zR;
  return sqrt(d * (2.0 * zR - d));
}

vec3 straight3(vec4 s) {
  return s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
}

void main() {${projective ? `
  // Pane-local coordinates: invert the pane→surface homography. A
  // non-positive w means the fragment looks past the plane's horizon
  // (behind the camera) — nothing there.
  vec2 px = v_uv * u_texSize;
  vec3 lh = u_hinv * vec3(px, 1.0);
  if (lh.z <= 0.0) { fragColor = vec4(0.0); return; }
  vec2 p = lh.xy / lh.z;` : `
  // Pane-local coordinates (rotate surface px by −θ around the centre).
  vec2 px = v_uv * u_texSize;
  vec2 rel = px - u_paneCenter;
  vec2 p = vec2(rel.x * u_rot.x + rel.y * u_rot.y,
                -rel.x * u_rot.y + rel.y * u_rot.x);`}
  vec2 half_ = u_paneHalf;
  float r = min(u_geo.x, min(half_.x, half_.y));
  float sdf = rrSDF(p, half_, r);

  // ── Drop shadow — OUTSIDE the panel only ──
  if (sdf > 0.0) {
    float a = 0.0;
    if (u_shadow.x > 0.0) {
      float sdfShadow = rrSDF(p - vec2(0.0, u_shadow.z), half_, r);
      float d = max(sdfShadow - 1.0, 0.0);
      float spread = max(u_shadow.y, 1.0);
      float falloff = 1.0 / (spread * spread);
      float outerShadow = exp(-d * d * falloff) * 0.65;
      float contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.35;
      a = (outerShadow + contactShadow) * u_shadow.x;
    }
    fragColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  float mask = 1.0 - smoothstep(-1.5, 0.5, sdf);

  float maxD = min(half_.x, half_.y);
  float inside = -sdf;
  float edge = smoothstep(maxD * 0.35, 0.0, inside);

  // ── Surface normal via the bevel height field (e = 2px, analytic SDF
  // — no blurred-field facets, no measured-gradient lip) ──
  float zR = u_geo.y;
  float e = 2.0;
  float hC = bevelHeight(inside, zR);
  vec2 hGrad = vec2(
    bevelHeight(-rrSDF(p + vec2(e, 0.0), half_, r), zR) -
    bevelHeight(-rrSDF(p - vec2(e, 0.0), half_, r), zR),
    bevelHeight(-rrSDF(p + vec2(0.0, e), half_, r), zR) -
    bevelHeight(-rrSDF(p - vec2(0.0, e), half_, r), zR)) / (2.0 * e);
  vec3 N = normalize(vec3(-hGrad, 1.0));

  float depth = smoothstep(0.0, zR, inside);

  // ── Refraction ──
  float refrPow = 1.0 - 1.0 / 1.5;
  float thickNorm = (hC * 2.0) / max(zR * 2.0, 1.0);
  vec2 refrPx;
  if (u_geo.z < 0.5) {
    // Biconvex pill: entry + exit + through-thickness refraction,
    // plus a depth-scaled magnification pull toward the centre.
    vec2 surfRefr = hGrad * refrPow;
    refrPx = (surfRefr * 2.0 + surfRefr * thickNorm * 0.5) * u_optics.x * 30.0;
    vec2 centerDir = -p / max(half_, vec2(1.0));
    refrPx += centerDir * u_optics.x * 4.0 * depth;
  } else {
    // Dome: uniform magnification — contract sampling toward centre.
    refrPx = -p * u_optics.x * depth * 0.35;
  }

  // ── Chromatic aberration ──
  float caS = u_optics.y * 18.0 * (edge * 0.7 + 0.3) * 2.0;
  vec2 caD = N.xy * caS;

${projective ? `  // Pane-local sample points → surface px via the FORWARD homography
  // (refraction and aberration computed in the pane's frame).
  vec3 fR = u_h * vec3(p + refrPx + caD, 1.0);
  vec3 fG = u_h * vec3(p + refrPx, 1.0);
  vec3 fB = u_h * vec3(p + refrPx - caD, 1.0);
  vec2 uvR = clamp(fR.xy / (max(fR.z, 1e-4) * u_texSize), vec2(0.0), vec2(1.0));
  vec2 uvG = clamp(fG.xy / (max(fG.z, 1e-4) * u_texSize), vec2(0.0), vec2(1.0));
  vec2 uvB = clamp(fB.xy / (max(fB.z, 1e-4) * u_texSize), vec2(0.0), vec2(1.0));` : `  // Pane-local offsets → surface space (rotate by +θ) → uv.
  vec2 refrW = vec2(refrPx.x * u_rot.x - refrPx.y * u_rot.y,
                    refrPx.x * u_rot.y + refrPx.y * u_rot.x);
  vec2 caW = vec2(caD.x * u_rot.x - caD.y * u_rot.y,
                  caD.x * u_rot.y + caD.y * u_rot.x);
  vec2 base = v_uv + refrW / u_texSize;
  vec2 oCA = caW / u_texSize;
  vec2 uvR = clamp(base + oCA, vec2(0.0), vec2(1.0));
  vec2 uvG = clamp(base, vec2(0.0), vec2(1.0));
  vec2 uvB = clamp(base - oCA, vec2(0.0), vec2(1.0));`}
  if (u_geo.w > 0.5) { // GL-canvas snapshots are bottom-up
    uvR.y = 1.0 - uvR.y; uvG.y = 1.0 - uvG.y; uvB.y = 1.0 - uvB.y;
  }

  vec3 sharp = vec3(
    straight3(texture(u_sharp, uvR)).r,
    straight3(texture(u_sharp, uvG)).g,
    straight3(texture(u_sharp, uvB)).b);
  vec3 blur = vec3(
    straight3(texture(u_backdrop, uvR)).r,
    straight3(texture(u_backdrop, uvG)).g,
    straight3(texture(u_backdrop, uvB)).b);
  // Edge-weighted blur mix: centre fully frosted, rim 15% sharp.
  float edgeMix = 1.0 - edge * 0.15;
  vec3 col = mix(sharp, blur, edgeMix);

  // ── Saturation (reference: 0 = unchanged) ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.0 + u_look.y);

  // ── Tint (our color param in place of the reference's fixed cool tint) ──
  col = mix(col, u_tint.rgb, u_tint.a);
  col *= 1.0 + 0.06 * depth;

  // ── Fresnel ──
  float fres = pow(1.0 - abs(N.z), 4.0) * u_optics.w;

  // ── Specular highlights (multi-light Blinn-Phong, reference lights) ──
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(0.4, 0.7, 1.0));
  float sp = pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0);
  vec3 L2 = normalize(vec3(-0.3, -0.5, 1.0));
  sp += pow(max(dot(N, normalize(L2 + V)), 0.0), 50.0) * 0.3;
  vec3 L3 = normalize(vec3(0.1, 0.3, 1.0));
  sp += pow(max(dot(N, L3), 0.0), 6.0) * 0.1;
  vec3 L4 = normalize(vec3(0.0, 0.9, 0.4));
  sp += pow(max(dot(N, normalize(L4 + V)), 0.0), 120.0) * 0.6;
  float totalSpec = sp * u_look.x;

  // ── Inner border / stroke highlight ──
  float borderWidth = 1.5;
  float innerStroke = smoothstep(-borderWidth - 1.0, -borderWidth, sdf)
                    * (1.0 - smoothstep(-1.0, 0.0, sdf));
  float topBias = 0.5 + 0.5 * (-p.y / half_.y);
  innerStroke *= (0.4 + 0.6 * topBias);

  // ── Edge highlight & inner glow ──
  float rim = edge * u_optics.z * 0.22;
  float innerGlow = smoothstep(5.0, 0.0, -sdf) * u_optics.z * 0.15;

  // ── Environment-like reflection (fake) ──
  float envRefl = (N.y * 0.5 + 0.5) * fres * 0.08;

  // ── Composite ──
  vec3 fin = col;
  fin += vec3(totalSpec);
  fin += vec3(rim + innerGlow);
  fin += vec3(innerStroke * u_optics.z * 0.55);
  fin += vec3(envRefl);
  fin = mix(fin, vec3(1.0), fres * 0.2);

  float outA = mask * u_look.z;
  fragColor = vec4(clamp(fin, 0.0, 1.0), 1.0) * outA;
}
`;

interface GlassLocs {
  aPos: number;
  aUv: number;
  uTransform: WebGLUniformLocation | null;
  uUvRect: WebGLUniformLocation | null;
  uBackdrop: WebGLUniformLocation | null;
  uSharp: WebGLUniformLocation | null;
  uTexSize: WebGLUniformLocation | null;
  uPaneCenter: WebGLUniformLocation | null;
  uPaneHalf: WebGLUniformLocation | null;
  uRot: WebGLUniformLocation | null;
  uGeo: WebGLUniformLocation | null;
  uOptics: WebGLUniformLocation | null;
  uLook: WebGLUniformLocation | null;
  uShadow: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uH: WebGLUniformLocation | null;
  uHinv: WebGLUniformLocation | null;
}

// ─── Unit quad — same convention as the WebGPU backend ─────────────────────

// prettier-ignore
const UNIT_QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1,
   1, -1, 1, 1,
  -1,  1, 0, 0,
  -1,  1, 0, 0,
   1, -1, 1, 1,
   1,  1, 1, 0,
]);

// ─── Implementation ─────────────────────────────────────────────────────────

interface GLSurface {
  fbo: WebGLFramebuffer | null;
  width: number;
  height: number;
  physWidth: number;
  physHeight: number;
  flipY: boolean;
}

export class WebGL2Backend implements Backend {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;

  capabilities!: BackendCapabilities;

  private gl!: WebGL2RenderingContext;
  private vbo!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;

  private shapeProgram!: WebGLProgram;
  private shapeLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uColor: WebGLUniformLocation | null;
    uStrokeColor: WebGLUniformLocation | null;
    uStrokeWidth: WebGLUniformLocation | null;
    uCornerRadius: WebGLUniformLocation | null;
    uShapeType: WebGLUniformLocation | null;
    uSize: WebGLUniformLocation | null;
  };

  private shadowProgram!: WebGLProgram;
  private shadowLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uColor: WebGLUniformLocation | null;
    uBlur: WebGLUniformLocation | null;
    uCornerRadius: WebGLUniformLocation | null;
    uShapeType: WebGLUniformLocation | null;
    uSize: WebGLUniformLocation | null;
    uQuadSize: WebGLUniformLocation | null;
  };

  private gradientProgram!: WebGLProgram;
  private gradientLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uMeta: WebGLUniformLocation | null;
    uParams: WebGLUniformLocation | null;
    uSize: WebGLUniformLocation | null;
    uStops: WebGLUniformLocation | null;
    uStopOffsets: WebGLUniformLocation | null;
  };

  private texturedProgram!: WebGLProgram;
  private texturedLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uUvRect: WebGLUniformLocation | null;
    uTint: WebGLUniformLocation | null;
    uTex: WebGLUniformLocation | null;
    uCornerRadius: WebGLUniformLocation | null;
    uSize: WebGLUniformLocation | null;
    uAlphaGamma: WebGLUniformLocation | null;
  };

  private maskedProgram!: WebGLProgram;
  private maskedLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uUvRect: WebGLUniformLocation | null;
    uTex: WebGLUniformLocation | null;
    uMask: WebGLUniformLocation | null;
    uTint: WebGLUniformLocation | null;
    uMode: WebGLUniformLocation | null;
  };

  private backdropBlendProgram!: WebGLProgram;
  private backdropBlendLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uUvRect: WebGLUniformLocation | null;
    uSrc: WebGLUniformLocation | null;
    uBackdrop: WebGLUniformLocation | null;
    uMode: WebGLUniformLocation | null;
    uBackdropFlipY: WebGLUniformLocation | null;
  };

  private filteredProgram!: WebGLProgram;
  private filteredLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uUvRect: WebGLUniformLocation | null;
    uTex: WebGLUniformLocation | null;
    uTexel: WebGLUniformLocation | null;
    uSigma: WebGLUniformLocation | null;
    uColorOps: WebGLUniformLocation | null;
    uTint: WebGLUniformLocation | null;
  };

  private stylizedProgram!: WebGLProgram;
  private stylizedLocs!: {
    aPos: number;
    aUv: number;
    uTransform: WebGLUniformLocation | null;
    uUvRect: WebGLUniformLocation | null;
    uTex: WebGLUniformLocation | null;
    uAux: WebGLUniformLocation | null;
    uTexSize: WebGLUniformLocation | null;
    uParams: WebGLUniformLocation | null;
    uTint: WebGLUniformLocation | null;
  };

  private glassProgram!: WebGLProgram;
  private glassLocs!: GlassLocs;
  // Lazy projective variant (CKP/1.0 glass under 3D) — compiled on
  // first use so 2D documents never pay for it.
  private glass3dProgram: WebGLProgram | null = null;
  private glass3dLocs: GlassLocs | null = null;

  // Lazy PBR lit-shape program (§4.8) — only compiled when a lit shape
  // is first drawn; unlit documents never pay for it.
  private litShapeProgram: WebGLProgram | null = null;
  private litShapeLocs: {
    aPos: number; aUv: number;
    u: Record<string, WebGLUniformLocation | null>;
  } | null = null;

  // Lazy PBR lit-textured program (§4.8) — lit images / video / group
  // cards. Compiled on first lit textured draw.
  private litTexturedProgram: WebGLProgram | null = null;
  private litTexturedLocs: {
    aPos: number; aUv: number;
    u: Record<string, WebGLUniformLocation | null>;
  } | null = null;

  private nextTextureId = 1;
  private liveTextures = new Set<WebGLTexture_>();
  private framingActive = false;
  private disposed = false;

  /** Physical backing-store dims ÷ logical dims (renderResolution). */
  private pixelRatio = 1;
  /**
   * Offscreen-surface stack. Empty = drawing to the canvas. Each entry
   * redirects draws into a framebuffer; flipY compensates for GL's
   * bottom-up framebuffer textures so layers sample top-down like
   * uploaded images.
   */
  private surfaceStack: GLSurface[] = [];
  private renderTargetFbos = new Map<RenderTarget, WebGLFramebuffer>();

  /**
   * Set the blend function for the next draw. All draw methods call
   * this with their params' blend (or undefined → premultiplied over),
   * so state never leaks between draws. Alpha always composites with
   * source-over so blended elements still build coverage normally.
   */
  private applyBlend(mode: BlendMode | undefined): void {
    const gl = this.gl;
    switch (mode) {
      case 'add':
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'multiply':
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'screen':
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      default:
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  /** Dims + flip of whatever we're currently drawing into. */
  private currentSurface(): GLSurface {
    const top = this.surfaceStack[this.surfaceStack.length - 1];
    if (top) return top;
    return {
      fbo: null,
      width: this.width,
      height: this.height,
      physWidth: this.canvas.width,
      physHeight: this.canvas.height,
      flipY: false,
    };
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  async init(): Promise<boolean> {
    const log = getLogger();
    const gl = (this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      antialias: true,
    }) as WebGL2RenderingContext | null);

    if (!gl) {
      log.warn('WebGL2 not available in this environment');
      return false;
    }
    this.gl = gl;

    // Build pipelines.
    try {
      this.shapeProgram = this.buildProgram(SHAPE_VS, SHAPE_FS, 'shape');
      this.shapeLocs = {
        aPos: gl.getAttribLocation(this.shapeProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.shapeProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.shapeProgram, 'u_transform'),
        uColor: gl.getUniformLocation(this.shapeProgram, 'u_color'),
        uStrokeColor: gl.getUniformLocation(this.shapeProgram, 'u_strokeColor'),
        uStrokeWidth: gl.getUniformLocation(this.shapeProgram, 'u_strokeWidth'),
        uCornerRadius: gl.getUniformLocation(this.shapeProgram, 'u_cornerRadius'),
        uShapeType: gl.getUniformLocation(this.shapeProgram, 'u_shapeType'),
        uSize: gl.getUniformLocation(this.shapeProgram, 'u_size'),
      };

      this.shadowProgram = this.buildProgram(SHAPE_VS, SHADOW_FS, 'shadow');
      this.shadowLocs = {
        aPos: gl.getAttribLocation(this.shadowProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.shadowProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.shadowProgram, 'u_transform'),
        uColor: gl.getUniformLocation(this.shadowProgram, 'u_color'),
        uBlur: gl.getUniformLocation(this.shadowProgram, 'u_blur'),
        uCornerRadius: gl.getUniformLocation(this.shadowProgram, 'u_cornerRadius'),
        uShapeType: gl.getUniformLocation(this.shadowProgram, 'u_shapeType'),
        uSize: gl.getUniformLocation(this.shadowProgram, 'u_size'),
        uQuadSize: gl.getUniformLocation(this.shadowProgram, 'u_quadSize'),
      };

      this.gradientProgram = this.buildProgram(GRADIENT_VS, GRADIENT_FS, 'gradient');
      this.gradientLocs = {
        aPos: gl.getAttribLocation(this.gradientProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.gradientProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.gradientProgram, 'u_transform'),
        uMeta: gl.getUniformLocation(this.gradientProgram, 'u_meta'),
        uParams: gl.getUniformLocation(this.gradientProgram, 'u_params'),
        uSize: gl.getUniformLocation(this.gradientProgram, 'u_size'),
        uStops: gl.getUniformLocation(this.gradientProgram, 'u_stops'),
        uStopOffsets: gl.getUniformLocation(this.gradientProgram, 'u_stopOffsets'),
      };

      this.texturedProgram = this.buildProgram(TEXTURED_VS, TEXTURED_FS, 'textured');
      this.texturedLocs = {
        aPos: gl.getAttribLocation(this.texturedProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.texturedProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.texturedProgram, 'u_transform'),
        uUvRect: gl.getUniformLocation(this.texturedProgram, 'u_uvRect'),
        uTint: gl.getUniformLocation(this.texturedProgram, 'u_tint'),
        uTex: gl.getUniformLocation(this.texturedProgram, 'u_tex'),
        uCornerRadius: gl.getUniformLocation(this.texturedProgram, 'u_cornerRadius'),
        uSize: gl.getUniformLocation(this.texturedProgram, 'u_size'),
        uAlphaGamma: gl.getUniformLocation(this.texturedProgram, 'u_alphaGamma'),
      };

      this.maskedProgram = this.buildProgram(TEXTURED_VS, MASKED_FS, 'masked');
      this.maskedLocs = {
        aPos: gl.getAttribLocation(this.maskedProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.maskedProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.maskedProgram, 'u_transform'),
        uUvRect: gl.getUniformLocation(this.maskedProgram, 'u_uvRect'),
        uTex: gl.getUniformLocation(this.maskedProgram, 'u_tex'),
        uMask: gl.getUniformLocation(this.maskedProgram, 'u_mask'),
        uTint: gl.getUniformLocation(this.maskedProgram, 'u_tint'),
        uMode: gl.getUniformLocation(this.maskedProgram, 'u_mode'),
      };

      this.filteredProgram = this.buildProgram(TEXTURED_VS, FILTERED_FS, 'filtered');
      this.filteredLocs = {
        aPos: gl.getAttribLocation(this.filteredProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.filteredProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.filteredProgram, 'u_transform'),
        uUvRect: gl.getUniformLocation(this.filteredProgram, 'u_uvRect'),
        uTex: gl.getUniformLocation(this.filteredProgram, 'u_tex'),
        uTexel: gl.getUniformLocation(this.filteredProgram, 'u_texel'),
        uSigma: gl.getUniformLocation(this.filteredProgram, 'u_sigma'),
        uColorOps: gl.getUniformLocation(this.filteredProgram, 'u_colorOps'),
        uTint: gl.getUniformLocation(this.filteredProgram, 'u_tint'),
      };

      this.stylizedProgram = this.buildProgram(TEXTURED_VS, STYLIZED_FS, 'stylized');
      this.stylizedLocs = {
        aPos: gl.getAttribLocation(this.stylizedProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.stylizedProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.stylizedProgram, 'u_transform'),
        uUvRect: gl.getUniformLocation(this.stylizedProgram, 'u_uvRect'),
        uTex: gl.getUniformLocation(this.stylizedProgram, 'u_tex'),
        uAux: gl.getUniformLocation(this.stylizedProgram, 'u_aux'),
        uTexSize: gl.getUniformLocation(this.stylizedProgram, 'u_texSize'),
        uParams: gl.getUniformLocation(this.stylizedProgram, 'u_params'),
        uTint: gl.getUniformLocation(this.stylizedProgram, 'u_tint'),
      };

      this.glassProgram = this.buildProgram(TEXTURED_VS, glassFsSource(false), 'glass');
      this.glassLocs = this.glassLocsOf(this.glassProgram);

      this.backdropBlendProgram = this.buildProgram(TEXTURED_VS, BACKDROP_BLEND_FS, 'backdropBlend');
      this.backdropBlendLocs = {
        aPos: gl.getAttribLocation(this.backdropBlendProgram, 'a_pos'),
        aUv: gl.getAttribLocation(this.backdropBlendProgram, 'a_uv'),
        uTransform: gl.getUniformLocation(this.backdropBlendProgram, 'u_transform'),
        uUvRect: gl.getUniformLocation(this.backdropBlendProgram, 'u_uvRect'),
        uSrc: gl.getUniformLocation(this.backdropBlendProgram, 'u_src'),
        uBackdrop: gl.getUniformLocation(this.backdropBlendProgram, 'u_backdrop'),
        uMode: gl.getUniformLocation(this.backdropBlendProgram, 'u_mode'),
        uBackdropFlipY: gl.getUniformLocation(this.backdropBlendProgram, 'u_backdropFlipY'),
      };
    } catch (err) {
      log.error('WebGL2 shader compile failed:', err instanceof Error ? err.message : String(err));
      return false;
    }

    // Vertex buffer + VAO.
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD_VERTICES, gl.STATIC_DRAW);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    // Two attributes share the same VBO; we re-enable them per program because
    // the attribute indices may differ between shape and textured programs.
    // We bind them here for the shape program; in drawTexturedQuad we re-bind
    // for the textured program if locations differ.
    this.setupVertexAttribs(this.shapeLocs.aPos, this.shapeLocs.aUv);
    gl.bindVertexArray(null);

    // Premultiplied alpha blending.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Texture upload defaults.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    this.capabilities = {
      api: 'webgl2',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };

    log.info(`WebGL2 backend ready (maxTextureSize=${this.capabilities.maxTextureSize})`);
    return true;
  }

  private buildProgram(vsSrc: string, fsSrc: string, label: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc, `${label}.vs`);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc, `${label}.fs`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      throw new Error(`Link error (${label}): ${info}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  private compileShader(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      throw new Error(`Compile error (${label}): ${info}`);
    }
    return shader;
  }

  private setupVertexAttribs(aPos: number, aUv: number): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
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
    this.gl.viewport(0, 0, physW, physH);
  }

  // ─── Textures ─────────────────────────────────────────────────────────────

  createTexture(source: TextureSource): Texture {
    const { width, height } = sourceDimensions(source);
    const gl = this.gl;
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadToTexture(handle, source);

    const texture: WebGLTexture_ = { id: this.nextTextureId++, width, height, handle };
    this.liveTextures.add(texture);
    return texture;
  }

  updateTexture(texture: Texture, source: TextureSource): void {
    const t = texture as WebGLTexture_;
    this.uploadToTexture(t.handle, source);
  }

  private uploadToTexture(handle: WebGLTexture, source: TextureSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    // texImage2D accepts each of our source types directly.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source as any,
    );
  }

  destroyTexture(texture: Texture): void {
    const t = texture as WebGLTexture_;
    if (this.liveTextures.delete(t)) {
      this.gl.deleteTexture(t.handle);
    }
  }

  // ─── Frame lifecycle ──────────────────────────────────────────────────────

  beginFrame(clearColor: RGBA = [0, 0, 0, 1]): void {
    if (this.framingActive) {
      getLogger().warn('beginFrame called while another frame is in progress');
      this.endFrame();
    }
    this.framingActive = true;
    // Defensive: a frame never starts mid-target.
    this.surfaceStack.length = 0;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Viewport covers the PHYSICAL backing store — using logical dims
    // here broke hi-res (pixelRatio > 1) rendering by drawing into the
    // bottom-left fraction of the canvas.
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);
  }

  endFrame(): void {
    if (!this.framingActive) return;
    this.framingActive = false;
    if (this.surfaceStack.length > 0) {
      getLogger().warn('endFrame with unbalanced pushTarget — restoring canvas');
      this.surfaceStack.length = 0;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }
    // WebGL has no explicit submit; the browser presents after the current
    // RAF callback returns.
    this.gl.bindVertexArray(null);
  }

  // ─── Offscreen render targets ─────────────────────────────────────────────

  createRenderTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const physW = Math.max(1, Math.round(width * this.pixelRatio));
    const physH = Math.max(1, Math.round(height * this.pixelRatio));

    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, physW, physH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const texture: WebGLTexture_ = { id: this.nextTextureId++, width: physW, height: physH, handle };
    this.liveTextures.add(texture);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.currentSurface().fbo);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`render target framebuffer incomplete (0x${status.toString(16)})`);
    }

    const target: RenderTarget = { texture, width, height };
    this.renderTargetFbos.set(target, fbo);
    return target;
  }

  destroyRenderTarget(target: RenderTarget): void {
    const fbo = this.renderTargetFbos.get(target);
    if (fbo) {
      this.gl.deleteFramebuffer(fbo);
      this.renderTargetFbos.delete(target);
    }
    this.destroyTexture(target.texture);
  }

  pushTarget(target: RenderTarget, clearColor: RGBA = [0, 0, 0, 0]): void {
    const fbo = this.renderTargetFbos.get(target);
    if (!fbo) {
      getLogger().warn('pushTarget with unknown / destroyed target — ignored');
      return;
    }
    const gl = this.gl;
    const tex = target.texture as WebGLTexture_;
    this.surfaceStack.push({
      fbo,
      width: target.width,
      height: target.height,
      physWidth: tex.width,
      physHeight: tex.height,
      flipY: true,
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, tex.width, tex.height);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  popTarget(): void {
    if (this.surfaceStack.length === 0) {
      getLogger().warn('popTarget without matching pushTarget — ignored');
      return;
    }
    this.surfaceStack.pop();
    const s = this.currentSurface();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    gl.viewport(0, 0, s.physWidth, s.physHeight);
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  drawShapeShadow(params: ShapeShadowDrawParams): void {
    if (!this.framingActive) return;
    this.applyBlend(undefined);
    if (params.blur <= 0 && params.offsetX === 0 && params.offsetY === 0) return;
    const gl = this.gl;
    const blur = Math.max(0, params.blur);
    // The shadow quad spans the shape PLUS `blur` pixels on every
    // side. Center it on the shape, then displace by the user's offset.
    const quadW = params.width + blur * 2;
    const quadH = params.height + blur * 2;
    const surface = this.currentSurface();
    const transform = params.transform
      ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
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
          surface.flipY,
        );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    gl.useProgram(this.shadowProgram);
    this.setupVertexAttribs(this.shadowLocs.aPos, this.shadowLocs.aUv);
    if (this.shadowLocs.uTransform) gl.uniformMatrix4fv(this.shadowLocs.uTransform, false, transform);
    if (this.shadowLocs.uColor) gl.uniform4f(this.shadowLocs.uColor, params.color[0], params.color[1], params.color[2], params.color[3]);
    if (this.shadowLocs.uBlur) gl.uniform1f(this.shadowLocs.uBlur, blur);
    if (this.shadowLocs.uCornerRadius) gl.uniform1f(this.shadowLocs.uCornerRadius, cornerRadius);
    if (this.shadowLocs.uShapeType) gl.uniform1f(this.shadowLocs.uShapeType, shapeType);
    if (this.shadowLocs.uSize) gl.uniform2f(this.shadowLocs.uSize, params.width, params.height);
    if (this.shadowLocs.uQuadSize) gl.uniform2f(this.shadowLocs.uQuadSize, quadW, quadH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawShape(params: ShapeDrawParams): void {
    if (!this.framingActive) return;
    if (params.gradient) {
      this.drawGradientShape(params);
      return;
    }
    if (params.lit) {
      this.drawLitShape(params);
      return;
    }
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0, surface.flipY,
        );
    // cornerRadius is PIXELS — clamp to half the smaller side so overflowing
    // values still produce a sensible shape (full-corner pill or circle).
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    gl.useProgram(this.shapeProgram);
    this.setupVertexAttribs(this.shapeLocs.aPos, this.shapeLocs.aUv);

    if (this.shapeLocs.uTransform) gl.uniformMatrix4fv(this.shapeLocs.uTransform, false, transform);
    if (this.shapeLocs.uColor) gl.uniform4f(this.shapeLocs.uColor, params.color[0], params.color[1], params.color[2], params.color[3]);
    const sw = params.strokeWidth ?? 0;
    const sc = params.strokeColor ?? params.color;
    if (this.shapeLocs.uStrokeColor) gl.uniform4f(this.shapeLocs.uStrokeColor, sc[0], sc[1], sc[2], sc[3]);
    if (this.shapeLocs.uStrokeWidth) gl.uniform1f(this.shapeLocs.uStrokeWidth, sw);
    if (this.shapeLocs.uCornerRadius) gl.uniform1f(this.shapeLocs.uCornerRadius, cornerRadius);
    if (this.shapeLocs.uShapeType) gl.uniform1f(this.shapeLocs.uShapeType, shapeType);
    if (this.shapeLocs.uSize) gl.uniform2f(this.shapeLocs.uSize, params.width, params.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private getLitShapeProgram(): WebGLProgram {
    if (!this.litShapeProgram) {
      const gl = this.gl;
      const prog = this.buildProgram(LIT_SHAPE_VS, LIT_SHAPE_FS, 'litShape');
      const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
      this.litShapeProgram = prog;
      this.litShapeLocs = {
        aPos: gl.getAttribLocation(prog, 'a_pos'),
        aUv: gl.getAttribLocation(prog, 'a_uv'),
        u: {
          transform: u('u_transform'), worldMatrix: u('u_worldMatrix'),
          albedo: u('u_albedo'), strokeAlbedo: u('u_strokeAlbedo'),
          strokeWidth: u('u_strokeWidth'), cornerRadius: u('u_cornerRadius'),
          shapeType: u('u_shapeType'), size: u('u_size'),
          normal: u('u_normal'), eye: u('u_eye'),
          rough: u('u_rough'), metal: u('u_metal'), reflect: u('u_reflect'),
          emissive: u('u_emissive'), ambient: u('u_ambient'),
          numLights: u('u_numLights'), lightDir: u('u_lightDir'), lightColor: u('u_lightColor'),
          envCount: u('u_envCount'), envColor: u('u_envColor'), envOffset: u('u_envOffset'), envAvg: u('u_envAvg'),
          tangent: u('u_tangent'), bitangent: u('u_bitangent'), normalScale: u('u_normalScale'),
          hasNormalMap: u('u_hasNormalMap'), normalMap: u('u_normalMap'),
          envIsImage: u('u_envIsImage'), envMap: u('u_envMap'),
        },
      };
    }
    return this.litShapeProgram;
  }

  private drawLitShape(params: ShapeDrawParams): void {
    const lit = params.lit!;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
      ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
      : composeQuadTransform(
        params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0, surface.flipY,
      );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    this.getLitShapeProgram();
    const { aPos, aUv, u } = this.litShapeLocs!;
    gl.useProgram(this.litShapeProgram!);
    this.setupVertexAttribs(aPos, aUv);

    if (u.transform) gl.uniformMatrix4fv(u.transform, false, transform);
    if (u.worldMatrix) gl.uniformMatrix4fv(u.worldMatrix, false, Array.from(lit.worldMatrix) as number[]);
    const alb = lit.albedo;
    if (u.albedo) gl.uniform4f(u.albedo, alb[0], alb[1], alb[2], alb[3]);
    const salb = lit.strokeAlbedo ?? alb;
    if (u.strokeAlbedo) gl.uniform4f(u.strokeAlbedo, salb[0], salb[1], salb[2], salb[3]);
    if (u.strokeWidth) gl.uniform1f(u.strokeWidth, params.strokeWidth ?? 0);
    if (u.cornerRadius) gl.uniform1f(u.cornerRadius, cornerRadius);
    if (u.shapeType) gl.uniform1f(u.shapeType, shapeType);
    if (u.size) gl.uniform2f(u.size, params.width, params.height);
    this.setLitPbrUniforms(u, lit);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Set the PBR uniforms shared by the lit-shape and lit-textured
  // programs (material, normal/eye, lights, environment). The env count
  // is set every draw — uniforms persist per-program, so a prior
  // env-bearing draw must not leak into one without an environment.
  private setLitPbrUniforms(u: Record<string, WebGLUniformLocation | null>, lit: LitParams): void {
    const gl = this.gl;
    if (u.normal) gl.uniform3f(u.normal, lit.normal[0], lit.normal[1], lit.normal[2]);
    if (u.eye) gl.uniform3f(u.eye, lit.eye[0], lit.eye[1], lit.eye[2]);
    if (u.rough) gl.uniform1f(u.rough, lit.roughness);
    if (u.metal) gl.uniform1f(u.metal, lit.metalness);
    if (u.reflect) gl.uniform1f(u.reflect, lit.reflectivity);
    if (u.emissive) gl.uniform1f(u.emissive, lit.emissive);
    if (u.ambient) gl.uniform3f(u.ambient, lit.ambient[0], lit.ambient[1], lit.ambient[2]);
    const n = Math.min(4, lit.lightDirs.length);
    if (u.numLights) gl.uniform1i(u.numLights, n);
    if (n > 0) {
      const dirs = new Float32Array(12);
      const cols = new Float32Array(12);
      for (let i = 0; i < n; i++) {
        dirs[i * 3] = lit.lightDirs[i]![0]; dirs[i * 3 + 1] = lit.lightDirs[i]![1]; dirs[i * 3 + 2] = lit.lightDirs[i]![2];
        cols[i * 3] = lit.lightColors[i]![0]; cols[i * 3 + 1] = lit.lightColors[i]![1]; cols[i * 3 + 2] = lit.lightColors[i]![2];
      }
      if (u.lightDir) gl.uniform3fv(u.lightDir, dirs.subarray(0, n * 3));
      if (u.lightColor) gl.uniform3fv(u.lightColor, cols.subarray(0, n * 3));
    }
    const env = lit.env;
    const ec = env ? Math.min(4, env.stopColors.length) : 0;
    if (u.envCount) gl.uniform1i(u.envCount, ec);
    if (ec > 0 && env) {
      const ecol = new Float32Array(12);
      const eoff = new Float32Array(4);
      for (let i = 0; i < ec; i++) {
        ecol[i * 3] = env.stopColors[i]![0]; ecol[i * 3 + 1] = env.stopColors[i]![1]; ecol[i * 3 + 2] = env.stopColors[i]![2];
        eoff[i] = env.stopOffsets[i]!;
      }
      if (u.envColor) gl.uniform3fv(u.envColor, ecol.subarray(0, ec * 3));
      if (u.envOffset) gl.uniform1fv(u.envOffset, eoff.subarray(0, ec));
    }
    // avg is the roughness-blur fallback for BOTH gradient and image envs.
    if (env && u.envAvg) gl.uniform3f(u.envAvg, env.avg[0], env.avg[1], env.avg[2]);
    // §4.8 Phase 2 normal map — bound to texture unit 1 (default flat
    // when absent so the sampler is always valid). Restore unit 0 after.
    const nm = lit.normalMap;
    if (u.hasNormalMap) gl.uniform1i(u.hasNormalMap, nm ? 1 : 0);
    if (u.normalScale) gl.uniform1f(u.normalScale, nm ? nm.scale : 1);
    if (nm) {
      if (u.tangent) gl.uniform3f(u.tangent, nm.tangent[0], nm.tangent[1], nm.tangent[2]);
      if (u.bitangent) gl.uniform3f(u.bitangent, nm.bitangent[0], nm.bitangent[1], nm.bitangent[2]);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nm ? (nm.texture as WebGLTexture_).handle : this.getFlatNormalTexture());
    if (u.normalMap) gl.uniform1i(u.normalMap, 1);

    // §4.8 Phase 3 image environment — bound to unit 2 (default flat when
    // absent; only sampled when u_envIsImage = 1).
    const envImg = env?.image as WebGLTexture_ | undefined;
    if (u.envIsImage) gl.uniform1i(u.envIsImage, envImg ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, envImg ? envImg.handle : this.getFlatNormalTexture());
    if (u.envMap) gl.uniform1i(u.envMap, 2);

    gl.activeTexture(gl.TEXTURE0);
  }

  // 1×1 flat tangent-space normal (#8080ff = (0,0,1)) bound when a lit
  // draw has no normal map, so the sampler always references a texture.
  private flatNormalTex: WebGLTexture | null = null;
  private getFlatNormalTexture(): WebGLTexture {
    if (!this.flatNormalTex) {
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([128, 128, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.flatNormalTex = tex;
    }
    return this.flatNormalTex;
  }

  private getLitTexturedProgram(): WebGLProgram {
    if (!this.litTexturedProgram) {
      const gl = this.gl;
      const prog = this.buildProgram(LIT_TEXTURED_VS, LIT_TEXTURED_FS, 'litTextured');
      const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
      this.litTexturedProgram = prog;
      this.litTexturedLocs = {
        aPos: gl.getAttribLocation(prog, 'a_pos'),
        aUv: gl.getAttribLocation(prog, 'a_uv'),
        u: {
          transform: u('u_transform'), worldMatrix: u('u_worldMatrix'), uvRect: u('u_uvRect'),
          tex: u('u_tex'), tint: u('u_tint'), cornerRadius: u('u_cornerRadius'), size: u('u_size'),
          normal: u('u_normal'), eye: u('u_eye'),
          rough: u('u_rough'), metal: u('u_metal'), reflect: u('u_reflect'),
          emissive: u('u_emissive'), ambient: u('u_ambient'),
          numLights: u('u_numLights'), lightDir: u('u_lightDir'), lightColor: u('u_lightColor'),
          envCount: u('u_envCount'), envColor: u('u_envColor'), envOffset: u('u_envOffset'), envAvg: u('u_envAvg'),
          tangent: u('u_tangent'), bitangent: u('u_bitangent'), normalScale: u('u_normalScale'),
          hasNormalMap: u('u_hasNormalMap'), normalMap: u('u_normalMap'),
          envIsImage: u('u_envIsImage'), envMap: u('u_envMap'),
        },
      };
    }
    return this.litTexturedProgram;
  }

  private drawLitTexturedQuad(params: TexturedQuadDrawParams): void {
    const lit = params.lit!;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
      ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
      : composeQuadTransform(
        params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0, surface.flipY,
      );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const uvRect = params.uvRect ?? [0, 0, 1, 1];
    const tint = params.tint ?? [1, 1, 1, 1];

    this.getLitTexturedProgram();
    const { aPos, aUv, u } = this.litTexturedLocs!;
    gl.useProgram(this.litTexturedProgram!);
    this.setupVertexAttribs(aPos, aUv);

    if (u.transform) gl.uniformMatrix4fv(u.transform, false, transform);
    if (u.worldMatrix) gl.uniformMatrix4fv(u.worldMatrix, false, Array.from(lit.worldMatrix) as number[]);
    if (u.uvRect) gl.uniform4f(u.uvRect, uvRect[0], uvRect[1], uvRect[2], uvRect[3]);
    if (u.tint) gl.uniform4f(u.tint, tint[0], tint[1], tint[2], tint[3]);
    if (u.cornerRadius) gl.uniform1f(u.cornerRadius, cornerRadius);
    if (u.size) gl.uniform2f(u.size, params.width, params.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (params.texture as WebGLTexture_).handle);
    if (u.tex) gl.uniform1i(u.tex, 0);
    this.setLitPbrUniforms(u, lit);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawGradientShape(params: ShapeDrawParams): void {
    if (!this.framingActive || !params.gradient) return;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0, surface.flipY,
        );
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    const shapeType = params.shape === 'ellipse' ? 1 : 0;

    const g = params.gradient;
    const fillType = g.type === 'radial' ? 1 : 0;
    const stops = g.stops.slice(0, 4);
    const nStops = Math.max(2, stops.length);

    // Flatten stop colors into a 16-float array (4 stops × 4 floats); pad
    // missing slots with the last stop's color.
    const stopColors = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const stop = stops[i] ?? stops[stops.length - 1]!;
      stopColors[i * 4] = stop.color[0];
      stopColors[i * 4 + 1] = stop.color[1];
      stopColors[i * 4 + 2] = stop.color[2];
      stopColors[i * 4 + 3] = stop.color[3];
    }
    const stopOffsets = new Float32Array(4);
    for (let i = 0; i < 4; i++) stopOffsets[i] = stops[i] ? stops[i]!.offset : 1;

    gl.useProgram(this.gradientProgram);
    this.setupVertexAttribs(this.gradientLocs.aPos, this.gradientLocs.aUv);

    if (this.gradientLocs.uTransform) gl.uniformMatrix4fv(this.gradientLocs.uTransform, false, transform);
    if (this.gradientLocs.uMeta) gl.uniform4f(this.gradientLocs.uMeta, cornerRadius, shapeType, fillType, nStops);
    if (this.gradientLocs.uSize) gl.uniform2f(this.gradientLocs.uSize, params.width, params.height);

    if (this.gradientLocs.uParams) {
      if (g.type === 'linear') {
        gl.uniform4f(this.gradientLocs.uParams, Math.cos(g.angle), Math.sin(g.angle), 0, 0);
      } else {
        gl.uniform4f(this.gradientLocs.uParams, g.cx, g.cy, g.radius, 0);
      }
    }

    if (this.gradientLocs.uStops) gl.uniform4fv(this.gradientLocs.uStops, stopColors);
    if (this.gradientLocs.uStopOffsets) gl.uniform4fv(this.gradientLocs.uStopOffsets, stopOffsets);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawTexturedQuad(params: TexturedQuadDrawParams): void {
    if (!this.framingActive) return;
    if (params.lit) {
      this.drawLitTexturedQuad(params);
      return;
    }
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, params.skewX ?? 0, params.skewY ?? 0, surface.flipY,
        );
    const uvRect = params.uvRect ?? [0, 0, 1, 1];
    const tint = params.tint ?? [1, 1, 1, 1];

    gl.useProgram(this.texturedProgram);
    this.setupVertexAttribs(this.texturedLocs.aPos, this.texturedLocs.aUv);

    if (this.texturedLocs.uTransform) gl.uniformMatrix4fv(this.texturedLocs.uTransform, false, transform);
    if (this.texturedLocs.uUvRect) gl.uniform4f(this.texturedLocs.uUvRect, uvRect[0]!, uvRect[1]!, uvRect[2]!, uvRect[3]!);
    if (this.texturedLocs.uTint) gl.uniform4f(this.texturedLocs.uTint, tint[0], tint[1], tint[2], tint[3]);
    const cornerRadius = Math.max(0, Math.min(params.cornerRadius ?? 0, Math.min(params.width, params.height) * 0.5));
    if (this.texturedLocs.uCornerRadius) gl.uniform1f(this.texturedLocs.uCornerRadius, cornerRadius);
    if (this.texturedLocs.uSize) gl.uniform2f(this.texturedLocs.uSize, params.width, params.height);
    if (this.texturedLocs.uAlphaGamma) gl.uniform1f(this.texturedLocs.uAlphaGamma, params.alphaGamma ?? 1);

    const t = params.texture as WebGLTexture_;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.handle);
    if (this.texturedLocs.uTex) gl.uniform1i(this.texturedLocs.uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawMaskedQuad(params: MaskedQuadDrawParams): void {
    if (!this.framingActive) return;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = params.transform
        ? projectPixelMatrix(params.transform, surface.width, surface.height, surface.flipY)
        : composeQuadTransform(
          params.cx, params.cy, params.width, params.height, params.rotation, surface.width, surface.height, 0, 0, surface.flipY,
        );
    const tint = params.tint ?? [1, 1, 1, 1];
    const mode =
      params.mode === 'alpha' ? 0 :
      params.mode === 'alpha-inverted' ? 1 :
      params.mode === 'luma' ? 2 : 3;

    gl.useProgram(this.maskedProgram);
    this.setupVertexAttribs(this.maskedLocs.aPos, this.maskedLocs.aUv);

    if (this.maskedLocs.uTransform) gl.uniformMatrix4fv(this.maskedLocs.uTransform, false, transform);
    if (this.maskedLocs.uUvRect) gl.uniform4f(this.maskedLocs.uUvRect, 0, 0, 1, 1);
    if (this.maskedLocs.uTint) gl.uniform4f(this.maskedLocs.uTint, tint[0], tint[1], tint[2], tint[3]);
    if (this.maskedLocs.uMode) gl.uniform1f(this.maskedLocs.uMode, mode);

    const content = params.content as WebGLTexture_;
    const mask = params.mask as WebGLTexture_;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, content.handle);
    if (this.maskedLocs.uTex) gl.uniform1i(this.maskedLocs.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mask.handle);
    if (this.maskedLocs.uMask) gl.uniform1i(this.maskedLocs.uMask, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Restore the conventional active unit so later single-texture
    // draws bind where they expect.
    gl.activeTexture(gl.TEXTURE0);
  }

  drawFilteredQuad(params: FilteredQuadDrawParams): void {
    if (!this.framingActive) return;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height, 0, 0, surface.flipY,
    );
    const tint = params.tint ?? [1, 1, 1, 1];
    const t = params.texture as WebGLTexture_;
    // blurRadius is logical px; texture dims are physical, so σ scales
    // by the pixel ratio and texel offsets divide by physical dims.
    const sigma = params.blurRadius * this.pixelRatio;

    gl.useProgram(this.filteredProgram);
    this.setupVertexAttribs(this.filteredLocs.aPos, this.filteredLocs.aUv);

    if (this.filteredLocs.uTransform) gl.uniformMatrix4fv(this.filteredLocs.uTransform, false, transform);
    if (this.filteredLocs.uUvRect) gl.uniform4f(this.filteredLocs.uUvRect, 0, 0, 1, 1);
    if (this.filteredLocs.uTexel) gl.uniform2f(this.filteredLocs.uTexel, params.blurDir[0] / t.width, params.blurDir[1] / t.height);
    if (this.filteredLocs.uSigma) gl.uniform1f(this.filteredLocs.uSigma, sigma);
    if (this.filteredLocs.uColorOps) gl.uniform4f(this.filteredLocs.uColorOps, params.brightness, params.contrast, params.saturation, ((params.hueRotate ?? 0) * Math.PI) / 180);
    if (this.filteredLocs.uTint) gl.uniform4f(this.filteredLocs.uTint, tint[0], tint[1], tint[2], tint[3]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.handle);
    if (this.filteredLocs.uTex) gl.uniform1i(this.filteredLocs.uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawBackdropBlend(params: BackdropBlendDrawParams): void {
    if (!this.framingActive) return;
    const gl = this.gl;
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.width / 2, params.height / 2, params.width, params.height, 0,
      surface.width, surface.height, 0, 0, surface.flipY,
    );
    const mode = params.mode === 'overlay' ? 0 : params.mode === 'hard-light' ? 1 : 2;

    gl.useProgram(this.backdropBlendProgram);
    this.setupVertexAttribs(this.backdropBlendLocs.aPos, this.backdropBlendLocs.aUv);
    // Output already carries the composited backdrop where src is
    // transparent, so REPLACE the target rather than blend over it.
    gl.blendFunc(gl.ONE, gl.ZERO);

    if (this.backdropBlendLocs.uTransform) gl.uniformMatrix4fv(this.backdropBlendLocs.uTransform, false, transform);
    if (this.backdropBlendLocs.uUvRect) gl.uniform4f(this.backdropBlendLocs.uUvRect, 0, 0, 1, 1);
    if (this.backdropBlendLocs.uMode) gl.uniform1i(this.backdropBlendLocs.uMode, mode);
    if (this.backdropBlendLocs.uBackdropFlipY) gl.uniform1f(this.backdropBlendLocs.uBackdropFlipY, params.backdropFlipY ? 1 : 0);

    const src = params.src as WebGLTexture_;
    const bd = params.backdrop as WebGLTexture_;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.handle);
    if (this.backdropBlendLocs.uSrc) gl.uniform1i(this.backdropBlendLocs.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bd.handle);
    if (this.backdropBlendLocs.uBackdrop) gl.uniform1i(this.backdropBlendLocs.uBackdrop, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.activeTexture(gl.TEXTURE0);
  }

  drawStylizedQuad(params: StylizedQuadDrawParams): void {
    if (!this.framingActive) return;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height, 0, 0, surface.flipY,
    );
    const tint = params.tint ?? [1, 1, 1, 1];
    const t = params.texture as WebGLTexture_;
    const aux = (params.aux ?? params.texture) as WebGLTexture_;
    // px-dimensioned params scale to PHYSICAL pixels; counts/angles/
    // intensities don't.
    const p0Px = params.mode !== 'dither' && params.mode !== 'glow'
      && params.mode !== 'chroma_key' && params.mode !== 'luma_key'
      && params.mode !== 'levels' && params.mode !== 'lut';
    const p1Px = params.mode === 'drop_shadow' || params.mode === 'turbulent_displace';
    const p0 = p0Px ? params.p0 * this.pixelRatio : params.p0;
    const p1 = p1Px ? (params.p1 ?? 0) * this.pixelRatio : (params.p1 ?? 0);
    const modeIdx = STYLIZE_MODE_INDEX[params.mode];

    gl.useProgram(this.stylizedProgram);
    this.setupVertexAttribs(this.stylizedLocs.aPos, this.stylizedLocs.aUv);

    if (this.stylizedLocs.uTransform) gl.uniformMatrix4fv(this.stylizedLocs.uTransform, false, transform);
    if (this.stylizedLocs.uUvRect) gl.uniform4f(this.stylizedLocs.uUvRect, 0, 0, 1, 1);
    if (this.stylizedLocs.uTexSize) gl.uniform2f(this.stylizedLocs.uTexSize, t.width, t.height);
    // u_params.w carries the pixel ratio so device-pixel-indexed effects
    // (dither's Bayer cell) can stay a stable LOGICAL-pixel size — i.e.
    // preview (hi-DPI) matches export (1×) instead of going sub-pixel.
    if (this.stylizedLocs.uParams) gl.uniform4f(this.stylizedLocs.uParams, modeIdx, p0, p1, this.pixelRatio);
    if (this.stylizedLocs.uTint) gl.uniform4f(this.stylizedLocs.uTint, tint[0], tint[1], tint[2], tint[3]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.handle);
    if (this.stylizedLocs.uTex) gl.uniform1i(this.stylizedLocs.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, aux.handle);
    if (this.stylizedLocs.uAux) gl.uniform1i(this.stylizedLocs.uAux, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  drawGlassQuad(params: GlassQuadDrawParams): void {
    if (!this.framingActive) return;
    const gl = this.gl;
    this.applyBlend(params.blend);
    const surface = this.currentSurface();
    const transform = composeQuadTransform(
      params.cx, params.cy, params.width, params.height, 0, surface.width, surface.height, 0, 0, surface.flipY,
    );
    const backdrop = params.backdrop as WebGLTexture_;
    const sharp = params.backdropSharp as WebGLTexture_;
    const pr = this.pixelRatio;
    const rad = (params.rotation * Math.PI) / 180;

    // CKP/1.0 glass under 3D (§4.7): a pane homography selects the
    // lazily-compiled projective variant. A singular homography is the
    // edge-on degenerate case — the pane is invisible, draw nothing.
    let h: Float32Array | null = null;
    let hinv: Float32Array | null = null;
    if (params.paneHomography) {
      h = homographyToPhysical(params.paneHomography, pr);
      hinv = invertHomography(h);
      if (!hinv) return;
      if (!this.glass3dProgram) {
        this.glass3dProgram = this.buildProgram(TEXTURED_VS, glassFsSource(true), 'glass3d');
        this.glass3dLocs = this.glassLocsOf(this.glass3dProgram);
      }
    }
    const program = h ? this.glass3dProgram! : this.glassProgram;
    const locs = h ? this.glass3dLocs! : this.glassLocs;

    gl.useProgram(program);
    this.setupVertexAttribs(locs.aPos, locs.aUv);

    if (locs.uTransform) gl.uniformMatrix4fv(locs.uTransform, false, transform);
    if (locs.uUvRect) gl.uniform4f(locs.uUvRect, 0, 0, 1, 1);
    // Surface dims, NOT the frosted texture's — the blur ladder
    // downsamples it; normalized UVs sample it fine either way.
    if (locs.uTexSize) gl.uniform2f(locs.uTexSize, surface.physWidth, surface.physHeight);
    if (locs.uPaneCenter) gl.uniform2f(locs.uPaneCenter, params.paneCx * pr, params.paneCy * pr);
    if (locs.uPaneHalf) gl.uniform2f(locs.uPaneHalf, params.paneHalfW * pr, params.paneHalfH * pr);
    if (locs.uRot) gl.uniform2f(locs.uRot, Math.cos(rad), Math.sin(rad));
    if (locs.uGeo) {
      gl.uniform4f(locs.uGeo, params.cornerRadius * pr, params.zRadius * pr, params.bevelMode, params.backdropFlipY ? 1 : 0);
    }
    if (locs.uOptics) gl.uniform4f(locs.uOptics, params.refract, params.chroma, params.edgeHighlight, params.fresnel);
    if (locs.uLook) gl.uniform4f(locs.uLook, params.specular, params.saturation, params.alpha, 0);
    if (locs.uShadow) gl.uniform4f(locs.uShadow, params.shadowAlpha, params.shadowSpread * pr, params.shadowOffY * pr, 0);
    if (locs.uTint) gl.uniform4f(locs.uTint, params.tint[0], params.tint[1], params.tint[2], params.tint[3]);
    if (h && locs.uH) gl.uniformMatrix3fv(locs.uH, false, h);
    if (hinv && locs.uHinv) gl.uniformMatrix3fv(locs.uHinv, false, hinv);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.handle);
    if (locs.uBackdrop) gl.uniform1i(locs.uBackdrop, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sharp.handle);
    if (locs.uSharp) gl.uniform1i(locs.uSharp, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  private glassLocsOf(program: WebGLProgram): GlassLocs {
    const gl = this.gl;
    return {
      aPos: gl.getAttribLocation(program, 'a_pos'),
      aUv: gl.getAttribLocation(program, 'a_uv'),
      uTransform: gl.getUniformLocation(program, 'u_transform'),
      uUvRect: gl.getUniformLocation(program, 'u_uvRect'),
      uBackdrop: gl.getUniformLocation(program, 'u_backdrop'),
      uSharp: gl.getUniformLocation(program, 'u_sharp'),
      uTexSize: gl.getUniformLocation(program, 'u_texSize'),
      uPaneCenter: gl.getUniformLocation(program, 'u_paneCenter'),
      uPaneHalf: gl.getUniformLocation(program, 'u_paneHalf'),
      uRot: gl.getUniformLocation(program, 'u_rot'),
      uGeo: gl.getUniformLocation(program, 'u_geo'),
      uOptics: gl.getUniformLocation(program, 'u_optics'),
      uLook: gl.getUniformLocation(program, 'u_look'),
      uShadow: gl.getUniformLocation(program, 'u_shadow'),
      uTint: gl.getUniformLocation(program, 'u_tint'),
      uH: gl.getUniformLocation(program, 'u_h'),
      uHinv: gl.getUniformLocation(program, 'u_hinv'),
    };
  }

  copySurfaceTo(target: RenderTarget): { flippedY: boolean } {
    const gl = this.gl;
    const fbo = this.renderTargetFbos.get(target);
    if (!fbo) {
      getLogger().warn('copySurfaceTo with unknown / destroyed target — ignored');
      return { flippedY: false };
    }
    const surface = this.currentSurface();
    const tex = target.texture as WebGLTexture_;
    // Same-rect blit (required when the canvas read buffer is
    // multisampled — the blit doubles as the MSAA resolve). The canvas
    // default framebuffer stores rows bottom-up; render-target FBOs are
    // drawn with a flipped projection so their rows are top-down. The
    // sampler compensates via the returned flag instead of flipping
    // here, which a multisample resolve blit would not allow.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, surface.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.blitFramebuffer(
      0, 0, surface.physWidth, surface.physHeight,
      0, 0, tex.width, tex.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.fbo);
    return { flippedY: surface.fbo === null };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  async finish(): Promise<void> {
    // gl.finish blocks until the pipeline drains.
    this.gl.finish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (!gl) return;
    for (const t of this.liveTextures) gl.deleteTexture(t.handle);
    this.liveTextures.clear();
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.shapeProgram) gl.deleteProgram(this.shapeProgram);
    if (this.gradientProgram) gl.deleteProgram(this.gradientProgram);
    if (this.texturedProgram) gl.deleteProgram(this.texturedProgram);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sourceDimensions(source: TextureSource): { width: number; height: number } {
  if ('codedWidth' in source && 'codedHeight' in source) {
    return { width: source.codedWidth, height: source.codedHeight };
  }
  if ('videoWidth' in source && 'videoHeight' in source) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ('naturalWidth' in source && 'naturalHeight' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
