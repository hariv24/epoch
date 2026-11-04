// city/world/textures.js · the shared texture loader + cache (docs/WORLD.md §10): Poly Haven PBR maps (webp) and painted canvas textures, with the
// sRGB / repeat / anisotropy handling the brownstone and Butler both used. A map is loaded once per (url, repeat, colour space) and shared.
import * as THREE from 'three';

export function createTextures({ onLoad = () => {}, anisotropy = 8 } = {}) {
  const TL = new THREE.TextureLoader(), cache = new Map();
  // tex(url, { rx, ry, srgb }): a repeating image map. `url` is a string or URL. onLoad fires when the image arrives (the caller dirties shadows / kicks a frame).
  function tex(url, { rx = 1, ry = 1, srgb = false } = {}) {
    const href = url.href || url, key = href + '|' + rx + '|' + ry + '|' + (srgb ? 's' : 'l');
    let t = cache.get(key); if (t) return t;
    t = TL.load(href, onLoad); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
    cache.set(key, t); return t;
  }
  // canvasTex(size, paint(ctx, size, rand), rx, ry, srgb): a texture painted once in a 2D canvas
  function canvasTex(size, paint, rx = 1, ry = 1, srgb = true, seed = size * 7 + rx * 13) {
    const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size, rng(seed));
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; return t;
  }
  return { tex, canvasTex, dispose() { for (const t of cache.values()) t.dispose(); cache.clear(); } };
}
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
