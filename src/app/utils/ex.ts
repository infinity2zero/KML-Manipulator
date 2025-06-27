import booleanIntersects from '@turf/boolean-intersects';
import booleanTouches   from '@turf/boolean-touches';
import intersect         from '@turf/intersect';
import area              from '@turf/area';
import length            from '@turf/length';

export interface FeatureRec {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  geom: any;
}

interface Box { minX:number; minY:number; maxX:number; maxY:number; }

/**
 * For polygons uses an area threshold; for lines uses a length threshold.
 */
export function computeOverlapByFileWithToleranceArea(
  features: FeatureRec[]
): Record<string,string[]> {
  // ── configurable thresholds ──
  const MIN_OVERLAP_AREA   = 1e-4;  // in map‐units²
  const MIN_OVERLAP_LENGTH = 0.001; // in kilometers (turf.length default)

  // 1) group features by filename
  const groups = new Map<string,FeatureRec[]>();
  for (const f of features) {
    const bucket = groups.get(f.name) ?? [];
    if (!groups.has(f.name)) groups.set(f.name, bucket);
    bucket.push(f);
  }
  const files = Array.from(groups.keys());

  // 2) init result & file‐envelopes
  const result: Record<string,string[]> = {};
  const fileBoxes = new Map<string,Box>();
  for (const name of files) {
    result[name] = [];
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const fr of groups.get(name)!) {
      const [x1,y1,x2,y2] = fr.bbox;
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }
    fileBoxes.set(name, { minX, minY, maxX, maxY });
  }

  // 3) pairwise test
  for (let i = 0; i < files.length; i++) {
    for (let j = i+1; j < files.length; j++) {
      const A = files[i], B = files[j];
      const boxA = fileBoxes.get(A)!, boxB = fileBoxes.get(B)!;

      // 3a) file‐envelope reject
      if (
        boxB.minX > boxA.maxX || boxB.maxX < boxA.minX ||
        boxB.minY > boxA.maxY || boxB.maxY < boxA.minY
      ) continue;

      // 3b) drill into features
      let found = false;
      outer: for (const ra of groups.get(A)!) {
        for (const rb of groups.get(B)!) {
          // bbox‐reject
          const [a1,a2,a3,a4] = ra.bbox;
          const [b1,b2,b3,b4] = rb.bbox;
          if (b1>a3||b3<a1||b2>a4||b4<a2) continue;

          // fast intersect?
          const fA:any = { type:'Feature', properties:{}, geometry: ra.geom };
          const fB:any = { type:'Feature', properties:{}, geometry: rb.geom };
          if (!booleanIntersects(fA,fB)) continue;

          // skip pure touches (point/line contact)
          if (booleanTouches(fA,fB)) continue;

          // get actual geometry
          const shared = intersect(fA,fB);
          if (!shared) continue;

          const geomType:any = shared.geometry.type;
          if (geomType === 'Point' || geomType === 'MultiPoint') {
            continue; // ignore trivial point‐overlaps
          }

          if (geomType === 'LineString' || geomType === 'MultiLineString') {
            // measure length in kilometers
            if (length(shared) < MIN_OVERLAP_LENGTH) continue;
          } else {
            // Polygon / MultiPolygon
            if (area(shared) < MIN_OVERLAP_AREA) continue;
          }

          // PASS: record overlap
          result[A].push(B);
          result[B].push(A);
          found = true;
          break outer;
        }
      }
      // next file‐pair
    }
  }

  // 4) dedupe & sort
  for (const name of files) {
    result[name] = Array.from(new Set(result[name])).sort();
  }
  return result;
}
