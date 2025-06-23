// src/app/services/overlap.service.ts
import { Injectable } from '@angular/core';
import simplify       from '@turf/simplify';
import RBush          from 'rbush';
import type { FeatureRec } from './worker/my-type';
import { IntersectPoolService } from './intersect-pool.service';

interface Entry { minX:number; minY:number; maxX:number; maxY:number; id:string; }

@Injectable({ providedIn: 'root' })
export class OverlapService {
  // how much to simplify (tweak to your data’s scale)
  private tolerance = 0.0005; 

  constructor(private pool: IntersectPoolService) {}

  /**
   * Pre-simplify every geometry, then run the R-tree‐batch checks.
   */
  public async computeOverlapByFileTree(
    features: FeatureRec[]
  ): Promise<Record<string,string[]>> {
    // 0) simplify each geometry once
    const simpFeatures = features.map(f => {
      // wrap as Feature so simplify() works
      const feature = {
        type: 'Feature' as const,
        properties: {},
        geometry: f.geom
      };
      const simp = simplify(feature, {
        tolerance: this.tolerance,
        highQuality: false,
        mutate: false
      });
      return { ...f, geom: simp.geometry };
    });

    // 1) group by file
    const groups = new Map<string, typeof simpFeatures>();
    for (const f of simpFeatures) {
      (groups.get(f.name) || groups.set(f.name, []).get(f.name)!).push(f);
    }
    const files = Array.from(groups.keys());
    const result: Record<string,string[]> = {};
    files.forEach(n => (result[n] = []));

    // 2) build a global R-tree of simplified bboxes
    const tree = new RBush<Entry>();
    tree.load(simpFeatures.map((f,idx) => ({
      minX: f.bbox[0], minY: f.bbox[1],
      maxX: f.bbox[2], maxY: f.bbox[3],
      id:    f.id
    })));
    const idMap = new Map(simpFeatures.map(f => [f.id, f] as const));
    const fileIds = new Map<string, Set<string>>();
    for (const name of files) {
      fileIds.set(name, new Set(groups.get(name)!.map(f=>f.id)));
    }

    // 3) one batch per file-pair
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const A = files[i], B = files[j];
        const pairs: [any,any][] = [];

        for (const ga of groups.get(A)!) {
          const hits = tree.search({
            minX: ga.bbox[0], minY: ga.bbox[1],
            maxX: ga.bbox[2], maxY: ga.bbox[3]
          });
          for (const h of hits) {
            if (!fileIds.get(B)!.has(h.id)) continue;
            const gb = idMap.get(h.id)!;
            pairs.push([ga.geom, gb.geom]);
          }
        }

        if (pairs.length > 0) {
          const hit = await this.pool.anyIntersect(pairs);
          if (hit) {
            result[A].push(B);
            result[B].push(A);
          }
        }
      }
    }

    // 4) dedupe
    for (const n of files) {
      result[n] = Array.from(new Set(result[n]));
    }
    return result;
  }
}


// import { Component } from '@angular/core';
// import { OverlapService } from './services/overlap.service';
// import { FeatureRec }   from './your-types';

// @Component({ /* ... */ })
// export class MyComponent {
//   constructor(private overlap: OverlapService) {}

//   async runOverlap(features: FeatureRec[]) {
//     const result = await this.overlap.computeOverlapByFileTree(features);
//     console.log(result);
//   }
// }

