// city/mh_landmarks.js · the five ladders live on real buildings (game.LADDER_LANDMARKS, sent in /api/world landmarks[].bin).
// Each unlocked section adds one beacon above the building's roof in the ladder's colour; the building itself takes the ladder's
// accent light in the tile shader (mh_tiles.js ACCENT: Empire State, Chrysler, Butler Library, One Times Square). The Brooklyn
// Bridge (Python) has no BIN: its cable lights are driven in manhattan.js. Beacons are the readable-from-afar part.
import { MS } from './palette.js';
import { makeGlow } from './mh_glow.js';
import * as THREE from 'three';

// notable id used when the payload names no BIN (older server) or a BIN we have not heard of
export const DEFAULT_BIN = { 'Python': null, 'Math': 1015862, 'ML/DL': 1036156, 'Papers': 1082165, 'Writing/X': 1085682 };

export function createLandmarkLights({ notables, TR }) {
  const glow = makeGlow(5 * 5 + 4);
  const byBin = new Map(notables.notables.filter((n) => n.bin).map((n) => [n.bin, n]));
  const state = {};                               // ladder -> {bin, sections, color}
  const col = new THREE.Color();
  function anchor(bin) { const n = byBin.get(bin); if (!n) return null; return { x: n.x, z: n.z, y: (n.baseY ?? TR.ground(n.x, n.z)) + (n.heightM || 20), h: n.heightM || 20 }; }
  function set(ladder, { bin, sections, color }) { state[ladder] = { bin: bin ?? DEFAULT_BIN[ladder] ?? null, sections: Math.max(0, Math.min(5, sections | 0)), color }; }
  /** pulse: 0..1 extra brightness for a just-lit section */
  function layout(pulse = {}, now = 0, motion = true) {
    glow.clear();
    for (const [ladder, s] of Object.entries(state)) {
      if (!s.bin || !s.sections) continue;
      const a = anchor(s.bin); if (!a) continue;
      const gap = Math.max(2.6, Math.min(7, a.h * 0.022)), p = pulse[ladder] || 0;
      for (let k = 0; k < s.sections; k++) {
        col.set(s.color || MS.beacon).lerp(new THREE.Color(MS.beacon), 0.25).multiplyScalar(1.1 + p * 1.6 + (motion ? 0.15 * Math.sin(now * 2.2 + k * 1.3) : 0));
        glow.add(a.x, a.y + 3 + k * gap, a.z, col.r, col.g, col.b, 26);
      }
    }
    glow.commit();
  }
  return { glow, set, layout, anchor };
}
