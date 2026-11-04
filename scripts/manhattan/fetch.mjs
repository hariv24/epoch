// Download stage: pulls the official NYC Open Data tables used for the Manhattan build into
// build/manhattan-raw/ (one JSON file per source). Re-runnable: existing files are reused unless
// --refresh is passed. Build-time only; the app itself never touches the network.
import fs from 'node:fs';
import path from 'node:path';

export const SOC = 'https://data.cityofnewyork.us/resource/';

async function getJson(url, tries = 5) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.slice(0, 200)}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw err;
}

/** Page through a Socrata resource and return all rows. */
export async function socrata(dataset, { select, where, order = ':id', page = 5000 } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += page) {
    const u = new URL(SOC + dataset + '.json');
    if (select) u.searchParams.set('$select', select);
    if (where) u.searchParams.set('$where', where);
    u.searchParams.set('$order', order);
    u.searchParams.set('$limit', String(page));
    u.searchParams.set('$offset', String(offset));
    const chunk = await getJson(u.toString());
    if (!Array.isArray(chunk)) throw new Error('Socrata error: ' + JSON.stringify(chunk).slice(0, 300));
    rows.push(...chunk);
    process.stdout.write(`  ${dataset}: ${rows.length} rows\r`);
    if (chunk.length < page) break;
  }
  process.stdout.write('\n');
  return rows;
}

/** One cached source. `spec` = { id, dataset, select, where, page } -> build/manhattan-raw/<id>.json */
export async function cached(rawDir, spec, refresh = false) {
  const file = path.join(rawDir, spec.id + '.json');
  if (!refresh && fs.existsSync(file) && fs.statSync(file).size > 2) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  console.log(`[fetch] ${spec.id} <- ${spec.dataset}`);
  const rows = await socrata(spec.dataset, spec);
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

// Everything the build needs. All Socrata datasets on data.cityofnewyork.us.
export const SOURCES = [
  { id: 'footprints', dataset: '5zhs-2jue', page: 4000,
    select: 'the_geom,bin,base_bbl,doitt_id,height_roof,ground_elevation,construction_year,feature_code,last_status_type,geom_source',
    where: 'bin>=1000000 AND bin<2000000' },
  { id: 'borough', dataset: 'gthc-hcne', where: "borocode='1'" },
  { id: 'nta', dataset: '9nt8-h7nd', where: "boroname='Manhattan'" },
  { id: 'parks', dataset: 'enfh-gkve', page: 2000,
    select: 'multipolygon,name311,signname,typecategory,subcategory,class,acres,borough,retired',
    where: "borough='M'" },
  // Centerline: the whole island box, filtered to Manhattan geometry later; bridges cross the rivers
  { id: 'centerline', dataset: 'inkn-q76z', page: 5000,
    select: 'the_geom,full_street_name,rw_type,boroughcode,trafdir,streetwidth,number_travel_lanes,status,segmentlength,pre_type',
    where: "within_box(the_geom,40.68,-74.06,40.93,-73.89)" },
  { id: 'pluto', dataset: '64uk-42ks', page: 5000,
    select: 'bbl,address,landuse,bldgclass,numfloors,yearbuilt,lotarea,bldgarea,numbldgs,histdist,landmark,latitude,longitude,zonedist1',
    where: "borough='MN'" },
  { id: 'landmarks', dataset: 'gpmc-yuvp', page: 5000,
    select: 'bin,bbl,des_addres,build_nme,arch_build,date_combo,style_prim,hist_dist,lm_orig,lm_new',
    where: "borough='MN'" },
  // Neighbouring-borough outlines only for an optional, very faint far-shore silhouette
  { id: 'boroughs_all', dataset: 'gthc-hcne', where: "borocode!='1'" },
];
