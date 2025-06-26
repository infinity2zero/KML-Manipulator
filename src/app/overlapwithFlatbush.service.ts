// Install Flatbush and Turf’s intersects fn:
// npm install flatbush @turf/boolean-intersects

import { Injectable } from '@angular/core';
import Flatbush from 'flatbush';
import booleanIntersects from '@turf/boolean-intersects';

export interface FeatureRec {
  id: string;                          // unique per geometry
  name: string;                        // group key / filename
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  geom: any;                           // GeoJSON geometry
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

@Injectable({ providedIn: 'root' })
export class OverlapService {
  /**
   * Compute overlaps by filename, using Flatbush for bulk‐load spatial indexing.
   */
  public computeOverlapByFileTree(
    features: FeatureRec[]
  ): Record<string, string[]> {
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
    const result: Record<string, string[]> = {};
    files.forEach(name => (result[name] = []));

    // 2) Compute each file’s envelope (big bbox)
    const fileBoxes = new Map<string, Box>();
    for (const name of files) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const fr of groups.get(name)!) {
        const [x1, y1, x2, y2] = fr.bbox;
        minX = Math.min(minX, x1);
        minY = Math.min(minY, y1);
        maxX = Math.max(maxX, x2);
        maxY = Math.max(maxY, y2);
      }
      fileBoxes.set(name, { minX, minY, maxX, maxY });
    }

    // 3) Bulk‐load all feature bboxes into Flatbush
    const tree = new Flatbush(features.length);
    features.forEach(f =>
      tree.add(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3])
    );
    tree.finish();

    // 4) For each unordered file‐pair, query once & drill down
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const A = files[i],
          B = files[j];
        const boxA = fileBoxes.get(A)!,
          boxB = fileBoxes.get(B)!;

        // 4a) Quick‐reject by file‐envelope
        if (
          boxB.minX > boxA.maxX ||
          boxB.maxX < boxA.minX ||
          boxB.minY > boxA.maxY ||
          boxB.maxY < boxA.minY
        ) {
          continue;
        }

        // 4b) Single Flatbush search of A’s envelope
        const candidateIdxs = tree.search(
          boxA.minX,
          boxA.minY,
          boxA.maxX,
          boxA.maxY
        );

        // 4c) Filter only B’s features
        const bSet = new Set(groups.get(B)!.map(fr => fr.id));
        const bCandidates = candidateIdxs
          .map((idx:any) => features[idx])
          .filter((f:any) => bSet.has(f.id));

        // 4d) Precise intersects check, break on first hit
        outer: for (const ra of groups.get(A)!) {
          for (const rb of bCandidates) {
            if (
              booleanIntersects(
                { type: 'Feature', properties: {}, geometry: ra.geom },
                { type: 'Feature', properties: {}, geometry: rb.geom }
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

    // 5) Dedupe & sort each overlap list
    for (const name of files) {
      result[name] = Array.from(new Set(result[name])).sort();
    }
    return result;
  }
}
