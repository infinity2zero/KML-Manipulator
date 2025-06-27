import booleanIntersects from '@turf/boolean-intersects';
import booleanTouches     from '@turf/boolean-touches';
import intersect          from '@turf/intersect';
import area               from '@turf/area';
import length             from '@turf/length';

interface Box { minX:number; minY:number; maxX:number; maxY:number; }

export interface FeatureRec {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  geom: any; // GeoJSON geometry
}

export function computeOverlapByFileHybrid(
  features: FeatureRec[]
): Record<string, string[]> {
  const COORD_TOLERANCE     = 0.0001;
  const MIN_OVERLAP_AREA    = 1e-4;
  const MIN_OVERLAP_LENGTH  = 0.001;

  const result: Record<string, string[]> = {};
  const groups = new Map<string, FeatureRec[]>();
  const fileBoxes = new Map<string, Box>();
  const fileStartId = new Map<string, string>();
  const fileStartCoord = new Map<string, [number, number]>();

  function isValidGeom(g: any): boolean {
    return g && typeof g === 'object' && typeof g.type === 'string' && Array.isArray(g.coordinates);
  }

  function getStartCoord(geom: any): [number, number] {
    try {
      switch (geom.type) {
        case 'Point': return geom.coordinates;
        case 'LineString':
        case 'MultiPoint': return geom.coordinates[0];
        case 'Polygon':
        case 'MultiLineString': return geom.coordinates[0][0];
        case 'MultiPolygon': return geom.coordinates[0][0][0];
        default: return [NaN, NaN];
      }
    } catch {
      return [NaN, NaN];
    }
  }

  function isNear(
    [x1, y1]: [number, number],
    [x2, y2]: [number, number]
  ): boolean {
    return Math.abs(x1 - x2) <= COORD_TOLERANCE &&
           Math.abs(y1 - y2) <= COORD_TOLERANCE;
  }

  function safeTouches(a: any, b: any): boolean {
    const unsupported = ['Point', 'MultiPoint'];
    if (
      unsupported.includes(a.geometry?.type) ||
      unsupported.includes(b.geometry?.type)
    ) return false;
    try {
      return booleanTouches(a, b);
    } catch {
      return false;
    }
  }

  // Group features and record metadata
  for (const f of features) {
    if (!isValidGeom(f.geom)) continue;

    const bucket = groups.get(f.name) ?? [];
    if (!groups.has(f.name)) groups.set(f.name, bucket);
    bucket.push(f);
  }

  const files = Array.from(groups.keys());
  for (const name of files) {
    result[name] = [];

    const recs = groups.get(name)!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of recs) {
      const [x1, y1, x2, y2] = f.bbox;
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }
    fileBoxes.set(name, { minX, minY, maxX, maxY });

    const start = recs[0];
    fileStartId.set(name, start.id);
    fileStartCoord.set(name, getStartCoord(start.geom));
  }

  // Pairwise file comparisons
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const A = files[i], B = files[j];
      const boxA = fileBoxes.get(A)!, boxB = fileBoxes.get(B)!;

      if (
        boxB.minX > boxA.maxX || boxB.maxX < boxA.minX ||
        boxB.minY > boxA.maxY || boxB.maxY < boxA.minY
      ) continue;

      const startIdA = fileStartId.get(A)!;
      const coordA = fileStartCoord.get(A)!;
      const startIdB = fileStartId.get(B)!;
      const coordB = fileStartCoord.get(B)!;

      let found = false;
      outer: for (const ra of groups.get(A)!) {
        for (const rb of groups.get(B)!) {
          if (!isValidGeom(ra.geom) || !isValidGeom(rb.geom)) continue;

          const [a1, a2, a3, a4] = ra.bbox;
          const [b1, b2, b3, b4] = rb.bbox;
          if (b1 > a3 || b3 < a1 || b2 > a4 || b4 < a2) continue;

          const fA:any = { type: 'Feature', properties: {}, geometry: ra.geom };
          const fB:any = { type: 'Feature', properties: {}, geometry: rb.geom };

          if (!booleanIntersects(fA, fB)) continue;
          if (safeTouches(fA, fB)) continue;

          let shared;
          try {
            shared = intersect(fA, fB);
          } catch {
            continue;
          }
          if (!shared?.geometry?.type) continue;

          const t:any = shared.geometry.type;
          if (t === 'Point' || t === 'MultiPoint') continue;
          if (t === 'LineString' || t === 'MultiLineString') {
            if (length(shared) < MIN_OVERLAP_LENGTH) continue;
          } else {
            if (area(shared) < MIN_OVERLAP_AREA) continue;
          }

          const isStartA = ra.id === startIdA;
          const isStartB = rb.id === startIdB;
          if (isStartA && isStartB && isNear(coordA, coordB)) continue;

          result[A].push(B);
          result[B].push(A);
          found = true;
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
