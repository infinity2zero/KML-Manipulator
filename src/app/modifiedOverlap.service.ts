// overlap.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, fromEventPattern, Observable, Subject, takeUntil }    from 'rxjs';
import * as JSZip          from 'jszip';
import RBush          from 'rbush';
import bbox           from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';
import type { Feature, Geometry } from 'geojson';
import { FeatureRec } from './my-type';

interface BoxEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  idx:  number;
}
interface PairCheck {
  a: FeatureRec;
  b: FeatureRec;
  hit: boolean;
}

interface Box { minX:number; minY:number; maxX:number; maxY:number }

@Injectable({ providedIn: 'root' })
export class OverlapNewService {
  /** Streams parsed features and a done signal from parser.worker.ts */
  public feature$ = new Subject<FeatureRec>();
  public done$    = new Subject<void>();
  public progress$ = new BehaviorSubject<number>(0);
  public overlapres$ = new BehaviorSubject<{}>({});
  /** In‐memory store of all FeatureRecs as they arrive */
  private feats = new Map<string, FeatureRec>();
  
  
totalFiles=0;
loadZip(buffer: ArrayBuffer): void {
    // 1) count files for progress
    let t1 = performance.now();
    JSZip.loadAsync(buffer).then(zip => {
      this.totalFiles = Object.values(zip.files)
        .filter(f => f.name.toLowerCase().endsWith('.kml'))
        .length || 1;
         
      // 2) spawn parser worker
      const worker = new Worker(
        new URL('./worker/parser.worker', import.meta.url),
        { type: 'module' }
      );
      let parsed = 0;

      worker.postMessage({ type: 'load', file: buffer }, [buffer]);

      fromEventPattern<MessageEvent>(
        h => worker.addEventListener('message', h),
        h => worker.removeEventListener('message', h)
      ).pipe(takeUntil(this.done$))
       .subscribe(evt => {
         const msg = evt.data as any;
         if (msg.type === 'feature') {
           const f: FeatureRec = msg.data;
           // index it
           this.feats.set(f.id, f);
           const [minX,minY,maxX,maxY] = f.bbox;
        //    this.tree.insert({ minX, minY, maxX, maxY, id: f.id });
           // emit to UI
           this.feature$.next(f);
           this.progress$.next(Math.round(++parsed / this.totalFiles * 100));
         }
         else if (msg.type === 'done') {
            let t2 = performance.now();
            console.log('time taken to parse KMLs', (t2 - t1) / 1000 + 's');
            this.done$.next();
            worker.terminate();
         }
       });
    });
  }

  /**
   * Build an N×N overlap matrix (0/1) once parsing is complete.
   * @param useTree  if true, uses RBush for pruning; otherwise O(N²)
   */
  computeMatrixFromParsed(useTree = false): number[][] {
    const all = Array.from(this.feats.values());
    return useTree
      ? this.computeMatrixTree(all)
      : this.computeMatrix(all);
  }




  /**
   * Naïve O(N²) double loop with fast bbox‐only rejection.
   */
  private computeMatrix(features: FeatureRec[]): number[][] {
    const N = features.length;
    const M: number[][] = Array.from({ length: N },
      () => Array(N).fill(0));
    if (N < 2) return M;

    // pre‐extract AABBs
    const boxes = features.map(f => {
      const [minX, minY, maxX, maxY] = f.bbox;
      return { minX, minY, maxX, maxY };
    });

    for (let i = 0; i < N; i++) {
      const bi = boxes[i];
      for (let j = i + 1; j < N; j++) {
        const bj = boxes[j];
        // very fast AABB check
        if (
          bj.minX > bi.maxX ||
          bj.maxX < bi.minX ||
          bj.minY > bi.maxY ||
          bj.maxY < bi.minY
        ) continue;

        // wrap raw geometries in GeoJSON.Feature
        const featA: Feature = {
          type: 'Feature',
          properties: {},
          geometry: features[i].geom
        };
        const featB: Feature = {
          type: 'Feature',
          properties: {},
          geometry: features[j].geom
        };

        if (booleanIntersects(featA, featB)) {
          M[i][j] = 1;
          M[j][i] = 1;
        }
      }
    }
    return M;
  }

  /**
   * RBush‐accelerated overlap: O(N·logN + K) instead of O(N²).
   */
  private computeMatrixTree(features: FeatureRec[]): number[][] {
    const N = features.length;
    const M: number[][] = Array.from({ length: N },
      () => Array(N).fill(0));
    if (N < 2) return M;

    // 1) build the R-tree of all bboxes
    const tree = new RBush<BoxEntry>();
    const entries: BoxEntry[] = features.map((f, idx) => {
      const [minX, minY, maxX, maxY] = f.bbox;
      return { minX, minY, maxX, maxY, idx };
    });
    tree.load(entries);

    // 2) for each entry, only test actual overlapping bboxes
    for (const e of entries) {
      const hits = tree.search(e);
      hits.forEach(h => {
        if (h.idx <= e.idx) return;  // skip self & duplicates

        const featA: Feature = {
          type: 'Feature',
          properties: {},
          geometry: features[e.idx].geom
        };
        const featB: Feature = {
          type: 'Feature',
          properties: {},
          geometry: features[h.idx].geom
        };

        if (booleanIntersects(featA, featB)) {
          M[e.idx][h.idx] = 1;
          M[h.idx][e.idx] = 1;
        }
      });
    }

    return M;
  }






  /**
   * 
   * 
   * 
   */

  /**
 * Synchronous O(N²) version that returns
 * { [kmlName]: string[] }
 */

   computeJSONFromParsed(useTree = false): any {
    const all = Array.from(this.feats.values());
    return useTree
      ? this.computeOverlapByFileTree(all)
      : this.computeOverlapByFile(all);
  }

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
        const A:Feature = { type: 'Feature', properties: {}, geometry: features[i].geom };
        const B:Feature = { type: 'Feature', properties: {}, geometry: features[j].geom };
  
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
  
        const A:Feature = { type: 'Feature', properties: {}, geometry: features[e.idx].geom };
        const B:Feature = { type: 'Feature', properties: {}, geometry: features[h.idx].geom };
  
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


  public computeOverlapByFileTree(features: FeatureRec[]): Record<string,string[]> {
    // group + result init
    console.log('FROM FILE TREE---');
    
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
        // if(A===B) continue;
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
            // console.log('Finding intersection of',ra.name,rb.name);
            
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
    // for (const k of files) {
    //   result[k] = Array.from(new Set(result[k]));
    // }


    const sortedResult: Record<string,string[]> = {};
    Object.keys(result)
      .sort()                                 // sort filenames
      .forEach(name => {
        const uniques = Array.from(new Set(result[name]));
        uniques.sort();                       // sort overlap array
        sortedResult[name] = uniques;
      });
    return sortedResult;
  }

  public checkOverlap() {
    return new Promise(resolve => {
      const w = new Worker(
        new URL('./worker/intersectsV2.worker', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = ({ data }) => {
        resolve(data.overlaps);
        w.terminate();
      };
      w.postMessage(JSON.stringify(Array.from(this.feats.entries())));
    });
  }

  


  // private checkPair(a: FeatureRec, b: FeatureRec): Observable<PairCheck> {
  //   return new Observable<PairCheck>(sub => {
  //     const w = new Worker(
  //       new URL('./worker/intersects.worker', import.meta.url),
  //       { type: 'module' }
  //     );
  //     w.onmessage = ({ data }) => {
  //       if (data.type === 'result') {
  //         sub.next({ a, b, hit: data.data.hit });
  //         sub.complete();
  //         w.terminate();
  //       }
  //     };
  //     w.postMessage({ type: 'check', data: { target: a.geom, other: b.geom } });
  //   });
  // }

  // after your parser.worker.ts has filled `this.feats`
 
}