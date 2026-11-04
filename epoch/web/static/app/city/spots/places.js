// city/spots/places.js · the study spots' small, shared facts (no three.js here, so the World view and the Focus Screen can both read it).
//   SPOTS[id] = { name, short, scene: the builder module and variant, city: where it is on the real-Manhattan map (scene metres,
//               from city/manhattan/notables.json), building: true when it is indoors (World lights a window), roof: on a roof }
// Spots and prices live in epoch/economy_catalog.py (STUDY_SPOTS); this file only knows how to show them.
export const SPOTS = {
  butler: { name: 'Butler Library reading room', short: 'Butler Library', scene: ['butler.js', 'butler'], city: { notable: 'butler-library', x: 1851.3, z: -5272.4 }, building: true, art: 'library' },
  cafe_amsterdam: { name: 'A café on Amsterdam Ave', short: 'Amsterdam Ave café', scene: ['cafe.js', 'cafe'], city: { x: 2006, z: -5139 }, building: true, art: 'cafe' },
  low_steps: { name: 'Low Library steps', short: 'Low Library steps', scene: ['outdoor.js', 'steps'], city: { x: 1872, z: -5396 }, building: false, art: 'steps' },
  rooftop: { name: 'A rooftop in Morningside', short: 'Morningside rooftop', scene: ['rooftop.js', 'rooftop'], city: { home: true, x: 1795, z: -5795 }, building: false, roof: true, art: 'rooftop' },
  park_bench: { name: 'Central Park bench, the Mall', short: 'Central Park Mall', scene: ['outdoor.js', 'mall'], city: { x: 1432, z: -1499 }, building: false, art: 'park' },
  nypl_rose: { name: 'The grand reading room on Fifth Ave', short: 'Fifth Ave reading room', scene: ['butler.js', 'rose'], city: { x: 320, z: 512 }, building: true, art: 'library' },
  penthouse_desk: { name: 'Your penthouse desk', short: 'Penthouse desk', scene: ['penthouse.js', 'penthouse'], city: { dream: true, x: 1060, z: -320 }, building: true, roof: true, art: 'penthouse' },
};
export const SPOT_IDS = Object.keys(SPOTS);
export const spotOf = (id) => SPOTS[id] || SPOTS.butler;
