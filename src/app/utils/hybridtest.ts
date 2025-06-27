import booleanIntersects from '@turf/boolean-intersects';
import booleanTouches     from '@turf/boolean-touches';
import intersect          from '@turf/intersect';
import area               from '@turf/area';
import length             from '@turf/length';

interface Box { minX:number; minY:number; maxX:number; maxY:number; }

export interface FeatureRec {
  id: string;
  name: string; // file name
  bbox: [number, number, number, number];
  geom: any;    // GeoJSON geometry
}

export function computeOverlapByFileHybrid(
  features: FeatureRec[]
): Record<string, string[]> {
  const COORD_TOLERANCE     = 0.0001;
  const MIN_OVERLAP_AREA    = 1e-4;  // map units
  const MIN_OVERLAP_LENGTH  = 0.001; // in kilometers

  function getStartCoord(geom: any): [number, number] {
    switch (geom.type) {
      case 'Point': return geom.coordinates;
      case 'LineString':
      case 'MultiPoint': return geom.coordinates[0];
      case 'Polygon':
      case 'MultiLineString': return geom.coordinates[0][0];
      case 'MultiPolygon':    return geom.coordinates[0][0][0];
      default: throw new Error(`Unknown geom ${geom.type}`);
    }
  }

  function isNear(
    [x1, y1]: [number, number],
    [x2, y2]: [number, number]
  ): boolean {
    return Math.abs(x1 - x2) <= COORD_TOLERANCE &&
           Math.abs(y1 - y2) <= COORD_TOLERANCE;
  }

  const groups = new Map<string, FeatureRec[]>();
  for (const f of features) {
    const bucket = groups.get(f.name) ?? [];
    if (!groups.has(f.name)) groups.set(f.name, bucket);
    bucket.push(f);
  }
  const files = Array.from(groups.keys());

  const result: Record<string,string[]> = {};
  const fileBoxes = new Map<string, Box>();
  const fileStartId = new Map<string, string>();
  const fileStartCoord = new Map<string, [number, number]>();

  for (const name of files) {
    result[name] = [];

    // compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const recs = groups.get(name)!;
    for (const fr of recs) {
      const [x1, y1, x2, y2] = fr.bbox;
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }
    fileBoxes.set(name, { minX, minY, maxX, maxY });

    // record starting geometry info
    const start = recs[0];
    fileStartId.set(name, start.id);
    fileStartCoord.set(name, getStartCoord(start.geom));
  }

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const A = files[i], B = files[j];
      const boxA = fileBoxes.get(A)!, boxB = fileBoxes.get(B)!;

      if (
        boxB.minX > boxA.maxX || boxB.maxX < boxA.minX ||
        boxB.minY > boxA.maxY || boxB.maxY < boxA.minY
      ) continue;

      const startIdA = fileStartId.get(A), coordA = fileStartCoord.get(A)!;
      const startIdB = fileStartId.get(B), coordB = fileStartCoord.get(B)!;

      let matched = false;
      outer: for (const ra of groups.get(A)!) {
        for (const rb of groups.get(B)!) {
          const [a1, a2, a3, a4] = ra.bbox;
          const [b1, b2, b3, b4] = rb.bbox;
          if (b1 > a3 || b3 < a1 || b2 > a4 || b4 < a2) continue;

          const fA:any = { type: 'Feature', properties: {}, geometry: ra.geom };
          const fB:any = { type: 'Feature', properties: {}, geometry: rb.geom };

          if (!booleanIntersects(fA, fB)) continue;
          if (safeTouches(fA, fB)) continue;
          if (!ra.geom || !rb.geom) continue;
          if (!ra.geom.type || !rb.geom.type) continue;

          const shared = intersect(fA, fB);
          if (!shared) continue;

          const geomType:any = shared.geometry.type;
          if (geomType === 'Point' || geomType === 'MultiPoint') continue;

          if (geomType === 'LineString' || geomType === 'MultiLineString') {
            if (length(shared) < MIN_OVERLAP_LENGTH) continue;
          } else {
            if (area(shared) < MIN_OVERLAP_AREA) continue;
          }

          const isStartA = ra.id === startIdA;
          const isStartB = rb.id === startIdB;
          if (isStartA && isStartB && isNear(coordA, coordB)) {
            continue; // same start-point overlap only — skip
          }

          result[A].push(B);
          result[B].push(A);
          matched = true;
          break outer;
        }
      }
    }
  }

  for (const name of files) {
    result[name] = Array.from(new Set(result[name])).sort();
  }

  return result;
}
function safeTouches(a: any, b: any): boolean {
  const unsupported = ['Point', 'MultiPoint'];
  if (
    unsupported.includes(a.geometry.type) ||
    unsupported.includes(b.geometry.type)
  ) return false;
  return booleanTouches(a, b);
}
