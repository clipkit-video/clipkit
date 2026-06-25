// .cube 3D LUT loader (§4.7 `lut`) — fetch + parse + pack the lattice
// into an N²×N RGBA bitmap: N slices laid along x (slice index = blue
// level), u = red, v = green within a slice. The stylize shader does
// manual trilinear sampling over this atlas (two bilinear taps mixed
// across the blue axis), so the texture must use linear filtering —
// the backend's default.
//
// v1 scope: LUT_3D_SIZE only (1D LUTs rejected), default 0..1 domain.
// Values are clamped to [0, 1] and quantized to 8-bit, matching the
// pipeline's working precision.

export async function loadCube(url: string): Promise<{ bitmap: ImageBitmap; size: number }> {
  // 10s fetch timeout (mirrors loadImage) so a dead LUT URL can't dangle.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();

  let n = 0;
  const values: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) continue;
    if (up.startsWith('DOMAIN_MIN') || up.startsWith('DOMAIN_MAX')) {
      const expect = up.startsWith('DOMAIN_MIN') ? 0 : 1;
      const nums = line.split(/\s+/).slice(1).map(Number);
      if (nums.some((v) => v !== expect)) throw new Error('non-default DOMAIN not supported');
      continue;
    }
    if (up.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs not supported');
    if (up.startsWith('LUT_3D_SIZE')) {
      n = parseInt(line.split(/\s+/)[1] ?? '0', 10);
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) values.push(r, g, b);
    }
  }
  if (!Number.isInteger(n) || n < 2 || n > 256) throw new Error('missing or invalid LUT_3D_SIZE');
  if (values.length < n * n * n * 3) throw new Error('truncated LUT data');

  // .cube data order: red fastest, then green, then blue.
  const data = new Uint8ClampedArray(n * n * n * 4);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const o = (g * n * n + (b * n + r)) * 4;
        data[o] = Math.round(Math.min(1, Math.max(0, values[i++]!)) * 255);
        data[o + 1] = Math.round(Math.min(1, Math.max(0, values[i++]!)) * 255);
        data[o + 2] = Math.round(Math.min(1, Math.max(0, values[i++]!)) * 255);
        data[o + 3] = 255;
      }
    }
  }
  const bitmap = await createImageBitmap(new ImageData(data, n * n, n));
  return { bitmap, size: n };
}
