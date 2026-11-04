// Billionaires' Row silhouettes. The five towers of the final level post-date the 2014 3-D model (or sit on whole-lot footprints), so
// the footprint layer alone would extrude them into slabs. Each one is given a hand-built stack of roof tiers here, in the same
// "tier" form the 3-D-model buildings use (flat roof polygons; mesh.mjs draws the walls down to whatever lies below), so the tile
// pipeline, the LODs and the packer need no special case.
//
// The shapes come from the published drawings and photographs of each tower; the footprints, heights and positions come from the
// NYC footprint data. They are recognisable silhouettes, not survey-grade models:
//   Central Park Tower  217 W 57th     472 m  podium, then a slender shaft that cantilevers east over the Art Students League and
//                                             steps in toward a slim, flat crown
//   111 W 57th (Steinway)              435 m  a 60 ft wide blade: the north face (toward the park) is a sheer wall, the south face
//                                             feathers down in eleven small setbacks, a pinnacle at the tip
//   One57                              306 m  keeps its own tiers from the 3-D model (it was already topped out in 2013)
//   220 Central Park South             290 m  limestone wedding-cake: the footprint stepping in from a base to a narrow crown
//   432 Park Avenue                    425 m  a pure 28.5 m square tube on a low base
// Everything is in the street-grid frame (u across the avenues, v along them) and converted back to the metre frame.
import { ringArea, pointInRing } from './geo.mjs';
import { flat } from './mesh.mjs';

const GA = (29 * Math.PI) / 180, CA = Math.cos(GA), SA = Math.sin(GA);
const toU = (x, z) => x * CA + z * SA, toV = (x, z) => x * SA - z * CA;
const fromUV = (u, v) => [u * CA + v * SA, u * SA - v * CA];
const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => fromUV(u, v));

/** one roof tier: a flat polygon at `h` metres above the building's ground */
function tier(g, ring, h) {
  return { rings3: [ring.map(([x, z]) => [x, z, g + h])], area: Math.abs(ringArea(ring)), zmean: g + h, zmax: g + h, plane: flat(g + h) };
}
function scaleAbout(ring, cx, cz, s) { return ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]); }

// style indices past the 14 the data build started with (kept in step with STYLES in buildings.mjs and STYLE_N in city/mh_tiles.js)
export const SUPERTALL_STYLE = { steinway: 14, parkGrid: 15, limestone: 16 };

const DESIGNS = {
  // Central Park Tower: lot-wide podium, then a shaft that overhangs the Art Students League (east) and steps in on every side
  1090180(b) {
    const g = b.gm, H = b.hm, steps = [
      [190, -123.0, -67.0, 876.0, 924.0], [290, -120.5, -68.2, 878.5, 921.5], [365, -117.5, -69.4, 880.5, 919.5],
      [420, -114.5, -71.0, 882.5, 917.5], [458, -111.0, -73.5, 885.0, 915.0],
    ];
    return [tier(g, b.parts[0][0], 70), ...steps.map(([h, u0, u1, v0, v1]) => tier(g, rect(u0, u1, v0, v1), h)), tier(g, rect(-106.0, -77.0, 891.0, 909.0), H)];
  },
  // 111 W 57th: the Steinway Hall base, then strips side by side along the lot (north, the park side, is the tallest and stays sheer)
  1023728(b) {
    const g = b.gm, H = b.hm, vN = 927.8, out = [tier(g, b.parts[0][0], 44)];
    const heights = [H - 17, H - 43, H - 69, H - 95, H - 123, H - 152, H - 183, H - 217, H - 253, H - 292, H - 333];
    heights.forEach((h, i) => {
      const narrow = i < 3, u0 = narrow ? 226.0 : 224.0, u1 = narrow ? 240.0 : 242.0;
      out.push(tier(g, rect(u0, u1, vN - 5 * (i + 1), vN - 5 * i), h));
    });
    out.push(tier(g, rect(230.5, 235.5, vN - 4.5, vN - 0.8), H));       // the pinnacle
    return out;
  },
  // 220 Central Park South: the L-shaped footprint (a wide south wing, a narrower arm toward the park) stepping in, then the arm alone
  // rising to a narrow limestone crown
  1090184(b) {
    const g = b.gm, H = b.hm;
    const ell = (d) => [[-132.6 + d, 947.4 + d], [-72.1 - d, 947.4 + d], [-72.1 - d, 1007.9 - d], [-94.7 + d, 1007.9 - d], [-94.7 + d, 977.6 - d], [-132.6 + d, 977.6 - d]].map(([u, v]) => fromUV(u, v));
    return [tier(g, b.parts[0][0], 58), tier(g, ell(1.8), 112), tier(g, ell(3.6), 164), tier(g, ell(5.4), 212),
      tier(g, rect(-89.0, -77.8, 979.5, 1003.5), 256), tier(g, rect(-86.0, -80.5, 984.0, 998.0), H)];
  },
  // 432 Park Avenue: the low base on the whole site, and the square tube on its north-west corner (a 28.5 m square)
  1088817(b) { return [tier(b.gm, b.parts[0][0], 24), tier(b.gm, rect(818.5, 847.0, 808.0, 836.5), b.hm)]; },
  // 432's second footprint record is a thin strip along Park Avenue that the footprint data gives the tower's height: it is base
  1035787(b) { return [tier(b.gm, b.parts[0][0], 24)]; },
};
const STYLE_OF = { 1090180: 13, 1023728: SUPERTALL_STYLE.steinway, 1090184: SUPERTALL_STYLE.limestone, 1088817: SUPERTALL_STYLE.parkGrid, 1035787: SUPERTALL_STYLE.parkGrid };

export function applySupertalls(buildings, log = console.log) {
  const done = [];
  for (const b of buildings) {
    const make = DESIGNS[b.bin];
    if (!make || !b.parts?.length) continue;
    const polys = make(b);
    b.tiers = { g: b.gm, polys };
    b.flags |= 8;                                    // FLAGS.TIERED
    b.synthetic = false;
    b.style = STYLE_OF[b.bin] ?? b.style;
    if (b.bin === 1035787) b.hm = 24;
    done.push(`${b.bin}:${polys.length}`);
  }
  log(`[supertalls] hand-built tiers for ${done.join(' ')}`);
}
void toU; void toV;
