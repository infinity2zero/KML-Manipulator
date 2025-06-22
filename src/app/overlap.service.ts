// // src/app/overlap.service.ts

// import { Injectable } from '@angular/core';
// import { BehaviorSubject, Subject, from, Observable, fromEventPattern } from 'rxjs';
// import { mergeMap, toArray, map, takeUntil } from 'rxjs/operators';
// import * as JSZip from 'jszip';
// import RBush from 'rbush';

// interface FeatureRec {
//   id: string;
//   name: string;
//   geom: any;
//   bbox: [number, number, number, number];
// }

// interface PairCheck {
//   a: FeatureRec;
//   b: FeatureRec;
//   hit: boolean;
// }

// @Injectable({ providedIn: 'root' })
// export class OverlapService {
//   /** Stream of parsed features (id, name, geom, bbox) */
//   public feature$ = new Subject<FeatureRec>();

//   /** Emits once when parsing is done */
//   public done$ = new Subject<void>();

//   /** Percentage progress of parsing [0–100] */
//   public progress$ = new BehaviorSubject<number>(0);

//   private tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
//   private feats = new Map<string, FeatureRec>();
//   private totalFiles = 0;

//   /** Max concurrent intersect checks */
//   private concurrency = 4;

//   /**
//    * Load and parse a ZIP (ArrayBuffer) of KMLs in a Web Worker.
//    * Emits each FeatureRec to feature$, updates progress$, and signals done$.
//    */
//   loadZip(buffer: ArrayBuffer): void {
//     // count KML entries for progress bar
//     JSZip.loadAsync(buffer).then(zip => {
//       this.totalFiles = Object.values(zip.files).filter(f => f.name.toLowerCase().endsWith('.kml')).length || 1;
//       // spawn parser worker
//       const worker = new Worker(new URL('./worker/parser.worker', import.meta.url), { type: 'module' });
//       let parsed = 0;

//       worker.postMessage({ type: 'load', file: buffer }, [buffer]);

//       const messages$ = fromEventPattern<MessageEvent>(
//         h => worker.addEventListener('message', h),
//         h => worker.removeEventListener('message', h)
//       ).pipe(takeUntil(this.done$));

//       messages$.subscribe(evt => {
//         const msg = evt.data as any;
//         if (msg.type === 'feature') {
//           const f: FeatureRec = msg.data;
//           // store in tree & map
//           this.feats.set(f.id, f);
//           const [minX, minY, maxX, maxY] = f.bbox;
//           this.tree.insert({ minX, minY, maxX, maxY, id: f.id });
//           // emit to UI
//           this.feature$.next(f);
//           // update progress
//           this.progress$.next(Math.round(++parsed / this.totalFiles * 100));
//         }
//         else if (msg.type === 'done') {
//           this.done$.next();
//           worker.terminate();
//         }
//       });
//     });
//   }

//   /**
//    * Detect all overlapping pairs among the parsed features.
//    * Returns an Observable that emits once with an array of [nameA, nameB].
//    */
//   detectAllOverlaps(): Observable<[string, string][]> {
//     const all = Array.from(this.feats.values());
//     const pairList: { a: FeatureRec; b: FeatureRec }[] = [];

//     // prune via R-tree: only bboxes that intersect and avoid duplicates
//     all.forEach((fa, i) => {
//       const hits = this.tree.search({
//         minX: fa.bbox[0], minY: fa.bbox[1],
//         maxX: fa.bbox[2], maxY: fa.bbox[3]
//       });
//       hits.forEach(h => {
//         const fb = this.feats.get(h.id)!;
//         if (fa.id === fb.id) return;
//         // only keep (fa, fb) where fb comes after fa in array
//         if (all.indexOf(fb) > i) {
//           pairList.push({ a: fa, b: fb });
//         }
//       });
//     });

//     // run precise intersects in parallel
//     return from(pairList).pipe(
//       mergeMap(pair => this.checkPair(pair.a, pair.b), this.concurrency),
//       toArray(),
//       map((results: PairCheck[]) =>
//         results
//           .filter(r => r.hit)
//           .map(r => [r.a.name, r.b.name] as [string, string])
//       )
//     );
//   }

//   /**
//    * Wraps a Turf booleanIntersects call in a Web Worker.
//    */
//   private checkPair(a: FeatureRec, b: FeatureRec): Observable<PairCheck> {
//     return new Observable<PairCheck>(sub => {
//       const w = new Worker(new URL('./worker/intersects.worker', import.meta.url), { type: 'module' });
//       w.onmessage = ({ data }) => {
//         if (data.type === 'result') {
//           sub.next({ a, b, hit: data.data.hit });
//           sub.complete();
//           w.terminate();
//         }
//       };
//       w.postMessage({ type: 'check', data: { target: a.geom, other: b.geom } });
//     });
//   }
// }
// src/app/overlap.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, from, Observable, forkJoin, fromEventPattern } from 'rxjs';
import { takeUntil, map, mergeMap, toArray } from 'rxjs/operators';
import * as JSZip from 'jszip';
import RBush from 'rbush';

interface FeatureRec {
  id: string;
  name: string;
  geom: any;
  bbox: [number, number, number, number];
}

interface OverlapResult {
  success: boolean;
  total: number;
  overlapped: number;
  misses: string[];
}

interface PairCheck {
  a: FeatureRec;
  b: FeatureRec;
  hit: boolean;
}

@Injectable({ providedIn: 'root' })
export class OverlapService {
  // streams for UI
  public feature$ = new Subject<FeatureRec>();
  public done$    = new Subject<void>();
  public progress$ = new BehaviorSubject<number>(0);

  private tree = new RBush<{ minX:number; minY:number; maxX:number; maxY:number; id:string }>();
  private feats = new Map<string, FeatureRec>();
  private totalFiles = 0;

  // tune this to your CPU cores
  private concurrency = 4;

  /**
   * Load & parse the ZIP of KMLs inside a Web Worker.
   * Emits each FeatureRec and updates progress$.
   */
  loadZip(buffer: ArrayBuffer): void {
    // 1) count files for progress
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
           this.tree.insert({ minX, minY, maxX, maxY, id: f.id });
           // emit to UI
           this.feature$.next(f);
           this.progress$.next(Math.round(++parsed / this.totalFiles * 100));
         }
         else if (msg.type === 'done') {
           this.done$.next();
           worker.terminate();
         }
       });
    });
  }

  /**
   * Check if one target KML overlaps *all* the rest.
   * Returns an Observable<OverlapResult>.
   */
  checkOverlap(targetId: string): Observable<OverlapResult> {
    const target = this.feats.get(targetId)!;
    const [minX,minY,maxX,maxY] = target.bbox;

    // prune by bbox
    const cands = this.tree.search({ minX,minY,maxX,maxY })
      .map(n => this.feats.get(n.id)!)
      .filter(f => f.id !== targetId);

    const calls = cands.map(f => this.checkPairSingle(target, f));

    return forkJoin(calls).pipe(
      map(results => {
        // misses among candidates
        const misses = results
          .filter(r => !r.hit)
          .map(r => this.feats.get(r.id)!.name);

        // any non-candidates are definite misses
        const allIds = Array.from(this.feats.keys())
          .filter(id => id !== targetId);
        const candIds = new Set(cands.map(f => f.id));
        allIds.forEach(id => {
          if (!candIds.has(id)) {
            misses.push(this.feats.get(id)!.name);
          }
        });

        const total = this.feats.size - 1;
        return {
          success: misses.length === 0,
          total,
          overlapped: total - misses.length,
          misses
        } as OverlapResult;
      })
    );
  }

  /**
   * Fully detect all overlapping pairs among the parsed KMLs.
   * Returns an Observable of an array of [nameA,nameB] pairs.
   */
  detectAllOverlaps(): Observable<[string,string][]> {
    const all = Array.from(this.feats.values());
    const pairList: { a:FeatureRec; b:FeatureRec }[] = [];

    // prune duplicates with single R-tree pass
    all.forEach((fa, i) => {
      const hits = this.tree.search({
        minX: fa.bbox[0], minY: fa.bbox[1],
        maxX: fa.bbox[2], maxY: fa.bbox[3]
      });
      hits.forEach(h => {
        const fb = this.feats.get(h.id)!;
        if (fa.id === fb.id) return;
        if (all.indexOf(fb) <= i) return; // only forward pairs
        pairList.push({ a: fa, b: fb });
      });
    });

    return from(pairList).pipe(
      mergeMap(pair => this.checkPair(pair.a, pair.b), this.concurrency),
      toArray(),
      map((results: PairCheck[]) =>
        results
          .filter(r => r.hit)
          .map(r => [r.a.name, r.b.name] as [string,string])
      )
    );
  }

  /** 
   * Wraps a single check of two geometries in a worker.
   * Used by both checkOverlap and detectAllOverlaps.
   */
  private checkPair(a: FeatureRec, b: FeatureRec): Observable<PairCheck> {
    return new Observable<PairCheck>(sub => {
      const w = new Worker(
        new URL('./worker/intersects.worker', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = ({ data }) => {
        if (data.type === 'result') {
          sub.next({ a, b, hit: data.data.hit });
          sub.complete();
          w.terminate();
        }
      };
      w.postMessage({ type: 'check', data: { target: a.geom, other: b.geom } });
    });
  }

  /** 
   * A leaner single‐pair check that returns {id,hit},  
   * used only by checkOverlap().
   */
  private checkPairSingle(a: FeatureRec, b: FeatureRec): Observable<{id:string,hit:boolean}> {
    return new Observable(sub => {
      const w = new Worker(
        new URL('./worker/intersects.worker', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = ({ data }) => {
        if (data.type === 'result') {
          sub.next({ id: b.id, hit: data.data.hit });
          sub.complete();
          w.terminate();
        }
      };
      w.postMessage({ type: 'check', data: { target: a.geom, other: b.geom } });
    });
  }
}
