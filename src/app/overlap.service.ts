// overlap.service.ts
import { Injectable } from '@angular/core';
import RBush from 'rbush';
import booleanIntersects from '@turf/boolean-intersects';

export interface FeatureRec {
  id: string;                    // unique per geometry
  name: string;                  // e.g. filename
  bbox: [number, number, number, number]; // [minX,minY,maxX,maxY]
  geom: any;                     // GeoJSON geometry
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

@Injectable({
  providedIn: 'root'
})
export class OverlapService {
  /**
   * Returns a map from filename → sorted list of overlapping filenames,
   * using a single global RBush search per file-pair.
   */
  public computeOverlapByFileTree(
    features: FeatureRec[]
  ): Record<string,string[]> {
    // 1) Group features by filename
    const groups = new Map<string, FeatureRec[]>();
    for (const f of features) {
      let bucket = groups.get(f.name);
      if (!bucket) {
        bucket = [];
        groups.set(f.name, bucket);
      }
      bucket.push(f);
    }

    const files = Array.from(groups.keys());
    const result: Record<string,string[]> = {};
    files.forEach(name => result[name] = []);

    // 2) Compute each file’s envelope (big bbox)
    const fileBoxes = new Map<string, Box>();
    for (const name of files) {
      let minX = Infinity, minY = Infinity,
          maxX = -Infinity, maxY = -Infinity;
      for (const fr of groups.get(name)!) {
        const [x1,y1,x2,y2] = fr.bbox;
        minX = Math.min(minX, x1);
        minY = Math.min(minY, y1);
        maxX = Math.max(maxX, x2);
        maxY = Math.max(maxY, y2);
      }
      fileBoxes.set(name, { minX, minY, maxX, maxY });
    }

    // 3) Build global RBush of all feature‐bboxes
    interface Entry { minX:number; minY:number; maxX:number; maxY:number; id:string; }
    const tree = new RBush<Entry>();
    tree.load(
      features.map(f => ({
        minX: f.bbox[0],
        minY: f.bbox[1],
        maxX: f.bbox[2],
        maxY: f.bbox[3],
        id:    f.id
      }))
    );
    const idMap = new Map(features.map(f => [f.id, f] as const));

    // 4) For each unordered file‐pair A,B
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const A = files[i], B = files[j];
        const boxA = fileBoxes.get(A)!, boxB = fileBoxes.get(B)!;

        // 4a) Quick‐reject on file‐envelopes
        if (
          boxB.minX > boxA.maxX || boxB.maxX < boxA.minX ||
          boxB.minY > boxA.maxY || boxB.maxY < boxA.minY
        ) {
          continue;
        }

        // 4b) Single tree.search on A’s envelope
        const candidates = tree.search({
          minX: boxA.minX, minY: boxA.minY,
          maxX: boxA.maxX, maxY: boxA.maxY
        });

        // 4c) Filter to only B’s features
        const bIds = new Set(groups.get(B)!.map(fr => fr.id));
        const bFeats = candidates
          .filter(e => bIds.has(e.id))
          .map(e => idMap.get(e.id)!) ;

        // 4d) Precise intersect test, early‐exit on first hit
        outer: for (const ra of groups.get(A)!) {
          for (const rb of bFeats) {
            if (
              booleanIntersects(
                { type:'Feature', properties:{}, geometry: ra.geom },
                { type:'Feature', properties:{}, geometry: rb.geom }
              )
            ) {
              result[A].push(B);
              result[B].push(A);
              break outer;
            }
          }
        }
      }
    }

    // 5) Dedupe & sort each file’s overlap list
    for (const name of files) {
      result[name] = Array.from(new Set(result[name])).sort();
    }
    return result;
  }
}
