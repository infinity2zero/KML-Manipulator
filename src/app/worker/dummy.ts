/**
 * Synchronous O(N²) version that returns
 * { [kmlName]: string[] }
 */
public computeOverlapJson(features: FeatureRec[]): Record<string,string[]> {
  const N   = features.length;
  const out: Record<string,string[]> = {};
  // init an empty array for each feature name
  features.forEach(f => out[f.name] = []);

  // precompute AABBs
  const boxes = features.map(f => {
    const [minX, minY, maxX, maxY] = f.bbox;
    return { minX, minY, maxX, maxY };
  });

  for (let i = 0; i < N; i++) {
    const bi = boxes[i];
    for (let j = i + 1; j < N; j++) {
      const bj = boxes[j];
      // fast bbox‐reject
      if (
        bj.minX > bi.maxX ||
        bj.maxX < bi.minX ||
        bj.minY > bi.maxY ||
        bj.maxY < bi.minY
      ) continue;

      // wrap in proper GeoJSON.Features
      const A = { type: 'Feature', properties: {}, geometry: features[i].geom };
      const B = { type: 'Feature', properties: {}, geometry: features[j].geom };

      if (booleanIntersects(A, B)) {
        out[ features[i].name ].push(features[j].name);
        out[ features[j].name ].push(features[i].name);
      }
    }
  }

  return out;
}
/**
 * RBush‐accelerated version that returns
 * { [kmlName]: string[] }
 */
public computeOverlapJsonTree(features: FeatureRec[]): Record<string,string[]> {
  const N   = features.length;
  const out: Record<string,string[]> = {};
  features.forEach(f => out[f.name] = []);

  // build R-tree entries
  interface BoxEntry { minX:number; minY:number; maxX:number; maxY:number; idx:number }
  const tree = new RBush<BoxEntry>();
  const entries: BoxEntry[] = features.map((f, idx) => {
    const [minX, minY, maxX, maxY] = f.bbox;
    return { minX, minY, maxX, maxY, idx };
  });
  tree.load(entries);

  // for each entry, only test actual overlaps
  for (const e of entries) {
    const hits = tree.search(e);
    hits.forEach(h => {
      // skip self & duplicate pairs
      if (h.idx <= e.idx) return;

      const A = { type: 'Feature', properties: {}, geometry: features[e.idx].geom };
      const B = { type: 'Feature', properties: {}, geometry: features[h.idx].geom };

      if (booleanIntersects(A, B)) {
        const nameA = features[e.idx].name;
        const nameB = features[h.idx].name;
        out[nameA].push(nameB);
        out[nameB].push(nameA);
      }
    });
  }

  return out;
}


// after your parser.worker.ts has filled `this.feats`
const all = Array.from(this.feats.values());

// 1) naive JSON
const json1 = this.overlapService.computeOverlapJson(all);
// 2) R-tree optimized JSON
const json2 = this.overlapService.computeOverlapJsonTree(all);

console.log(JSON.stringify(json2, null, 2));




///NEw APPROACH

import booleanIntersects from '@turf/boolean-intersects';
import type { FeatureRec } from './your-types';

interface Box { minX:number; minY:number; maxX:number; maxY:number }

/**
 * Naïve grouping version.
 * Input: an array of FeatureRec, where rec.name is the KML file name.
 * Output: { [fileA]: [fileB, …], … }
 */
public computeOverlapByFile(features: FeatureRec[]): Record<string,string[]> {
  // 1) group features by filename
  const groups = new Map<string, FeatureRec[]>();
  for (const f of features) {
    (groups.get(f.name) || groups.set(f.name, []).get(f.name)!).push(f);
  }

  const files = Array.from(groups.keys());
  // init empty arrays
  const result: Record<string,string[]> = {};
  for (const name of files) {
    result[name] = [];
  }

  // 2) precompute per-file bboxes
  const fileBBoxes = new Map<string, Box>();
  for (const name of files) {
    const recs = groups.get(name)!;
    let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity;
    for (const r of recs) {
      const [x1,y1,x2,y2] = r.bbox;
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }
    fileBBoxes.set(name, { minX, minY, maxX, maxY });
  }

  // 3) test each file-pair
  for (let i = 0; i < files.length; i++) {
    for (let j = i+1; j < files.length; j++) {
      const A = files[i], B = files[j];
      const ba = fileBBoxes.get(A)!, bb = fileBBoxes.get(B)!;

      // 3a) cheap file‐bbox reject
      if ( bb.minX > ba.maxX || bb.maxX < ba.minX ||
           bb.minY > ba.maxY || bb.maxY < ba.minY ) {
        continue;
      }

      // 3b) drill into individual geometries
      let overlap = false;
      for (const ra of groups.get(A)!) {
        for (const rb of groups.get(B)!) {
          // fast bbox reject
          const [a1,a2,a3,a4] = ra.bbox;
          const [b1,b2,b3,b4] = rb.bbox;
          if (b1>a3 || b3<a1 || b2>a4 || b4<a2) continue;

          // precise test
          if (booleanIntersects(
            { type:'Feature', properties:{}, geometry: ra.geom },
            { type:'Feature', properties:{}, geometry: rb.geom }
          )) {
            result[A].push(B);
            result[B].push(A);
            overlap = true;
            break;
          }
        }
        if (overlap) break;
      }
      // move on to next pair
    }
  }

  // 4) dedupe (in case a file had multiple intersecting features)
  for (const k of files) {
    result[k] = Array.from(new Set(result[k]));
  }
  return result;
}


import RBush from 'rbush';

/**
 * R-tree–accelerated version, same output shape.
 */
public computeOverlapByFileTree(features: FeatureRec[]): Record<string,string[]> {
  // group + result init
  const groups = new Map<string, FeatureRec[]>();
  for (const f of features) {
    (groups.get(f.name) || groups.set(f.name, []).get(f.name)!).push(f);
  }
  const files = Array.from(groups.keys());
  const result: Record<string,string[]> = {};
  files.forEach(n => result[n] = []);

  // build global tree of all features
  interface Entry { minX:number; minY:number; maxX:number; maxY:number; id:string; }
  const tree = new RBush<Entry>();
  tree.load(features.map(f => {
    const [minX,minY,maxX,maxY] = f.bbox;
    return { minX,minY,maxX,maxY, id: f.id };
  }));
  // map id→FeatureRec
  const idMap = new Map(features.map(f => [f.id, f] as const));

  // per-file feature‐id sets for quick filtering
  const fileIdSets = new Map<string, Set<string>>();
  for (const name of files) {
    fileIdSets.set(name, new Set(groups.get(name)!.map(f=>f.id)));
  }

  // iterate file-pairs
  for (let i=0; i<files.length; i++) {
    for (let j=i+1; j<files.length; j++) {
      const A = files[i], B = files[j];
      const setB = fileIdSets.get(B)!;
      let overlap = false;

      // for each feature in A, query tree for any hits in B
      for (const ra of groups.get(A)!) {
        const hits = tree.search({
          minX: ra.bbox[0], minY: ra.bbox[1],
          maxX: ra.bbox[2], maxY: ra.bbox[3]
        });
        for (const h of hits) {
          if (!setB.has(h.id)) continue;   // not in B’s file
          const rb = idMap.get(h.id)!;
          // precise test
          if (booleanIntersects(
            { type:'Feature', properties:{}, geometry: ra.geom },
            { type:'Feature', properties:{}, geometry: rb.geom }
          )) {
            result[A].push(B);
            result[B].push(A);
            overlap = true;
            break;
          }
        }
        if (overlap) break;
      }
      // next pair
    }
  }

  // dedupe
  for (const k of files) {
    result[k] = Array.from(new Set(result[k]));
  }
  return result;
}


const allFeatures = Array.from(this.feats.values());

const jsonSimple = this.overlapService.computeOverlapByFile(allFeatures);
console.log(JSON.stringify(jsonSimple, null,2));

const jsonTree = this.overlapService.computeOverlapByFileTree(allFeatures);
console.log(JSON.stringify(jsonTree, null,2));




///service v2

import { Injectable } from '@angular/core';
import RBush from 'rbush';
import type { FeatureRec } from './your-types';
import { IntersectPoolService } from './intersect-pool.service';

interface Entry {
  minX: number; minY: number;
  maxX: number; maxY: number;
  id:     string;
}

@Injectable({ providedIn: 'root' })
export class OverlapService {
  constructor(private pool: IntersectPoolService) {}

  /**
   * File-level overlaps: for each pair of KML filenames,
   * we batch ALL their geometry‐pairs into one pool request.
   */
  public async computeOverlapByFileTree(
    features: FeatureRec[]
  ): Promise<Record<string,string[]>> {
    // 1) group features by file
    const groups = new Map<string,FeatureRec[]>();
    for (const f of features) {
      (groups.get(f.name) || groups.set(f.name, []).get(f.name)!).push(f);
    }
    const files = Array.from(groups.keys());
    const result: Record<string,string[]> = {};
    files.forEach(n => (result[n] = []));

    // 2) build a global R-tree of all bboxes
    const tree = new RBush<Entry>();
    tree.load(features.map((f,idx) => ({
      minX: f.bbox[0], minY: f.bbox[1],
      maxX: f.bbox[2], maxY: f.bbox[3],
      id: f.id
    })));
    const idMap = new Map(features.map(f => [f.id, f] as const));
    const fileIds = new Map<string,Set<string>>();
    for (const name of files) {
      fileIds.set(name, new Set(groups.get(name)!.map(f=>f.id)));
    }

    // 3) test each file-pair
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const A = files[i], B = files[j];
        let found = false;

        // collect ALL geometry-pairs whose bboxes overlap
        const pairs: [any, any][] = [];

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

        // ask the pool to test them all at once
        if (pairs.length > 0) {
          const hit = await this.pool.anyIntersect(pairs);
          if (hit) {
            result[A].push(B);
            result[B].push(A);
          }
        }
      }
    }

    // 4) dedupe final arrays
    for (const k of files) {
      result[k] = Array.from(new Set(result[k]));
    }
    return result;
  }
}

