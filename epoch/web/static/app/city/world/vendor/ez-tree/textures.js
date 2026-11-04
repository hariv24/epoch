// Vendored EZ-Tree (MIT, Daniel Greenheck) textures module, rewritten for Epoch: no bundler, so the maps load with new URL(..., import.meta.url).
// Only the oak bark (Poly Haven bark_brown_02, CC0) and the ash / oak leaf cards are vendored; every other bark or leaf type falls back to them.
import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();
const url = (f) => new URL('./assets/' + f, import.meta.url).href;
const loadTexture = (u, srgb = true) => {
  const texture = textureLoader.load(u);
  texture.premultiplyAlpha = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
let textures = null;
function all() {
  if (textures) return textures;
  const oak = { ao: loadTexture(url('oak_ao.webp'), false), color: loadTexture(url('oak_color.webp')), normal: loadTexture(url('oak_normal.webp'), false), roughness: null };
  oak.roughness = oak.ao;
  textures = { bark: { oak, birch: oak, pine: oak, willow: oak }, leaves: { ash: loadTexture(url('ash_color.png')), oak: loadTexture(url('oak_color.png')) } };
  textures.leaves.aspen = textures.leaves.ash; textures.leaves.pine = textures.leaves.ash;
  return textures;
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const texture = (all().bark[barkType] || all().bark.oak)[fileType];
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.x = scale.x;
  texture.repeat.y = 1 / scale.y;
  return texture;
}

export function getLeafTexture(leafType) {
  return all().leaves[leafType] || all().leaves.ash;
}
