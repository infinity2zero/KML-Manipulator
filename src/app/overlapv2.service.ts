// overlap.service.ts
import { Injectable } from '@angular/core';
import { Subject, Observable, fromEventPattern, takeUntil, BehaviorSubject } from 'rxjs';
import RBush from 'rbush';
import type { FeatureRec } from './my-type';
import type { Geometry }   from 'geojson';
import * as JSZip from 'jszip';

interface Entry {
  minX: number; minY: number;
  maxX: number; maxY: number;
  id:     string;
}

@Injectable({ providedIn: 'root' })
export class OverlapServiceV2 {
  // —– PUBLIC STREAMS —–
  /** emits each parsed FeatureRec (from your parser.worker) */
  public feature$ = new Subject<FeatureRec>();
  /** fires once parsing is complete */
  public done$    = new Subject<void>();
  public progress$ = new BehaviorSubject<number>(0);
  /** emits the final { [kml]: [overlappingKml…] } map */
  private _result$ = new Subject<Record<string,string[]>>();
  public  result$: Observable<Record<string,string[]>> = this._result$.asObservable();

  // —– INTERNAL STATE —–
  private feats = new Map<string, FeatureRec>();

  /**
   * Your existing unzip+parse launcher.
   * Listens for 'feature' / 'done' from parser.worker,
   * fills this.feats, and emits on feature$/done$.
   */
   totalFiles=0;
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
           //    this.tree.insert({ minX, minY, maxX, maxY, id: f.id });
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
   * Fires up one intersects.worker to test a single geom-pair.
   */
  private testIntersect(a: Geometry, b: Geometry): Promise<boolean> {
    return new Promise(resolve => {
      const w = new Worker(
        new URL('./worker/intersectsV2.worker', import.meta.url),
        { type: 'module' }
      );
      w.onmessage = ({ data }) => {
        resolve(data.data.hit);
        w.terminate();
      };
      w.postMessage({ type: 'check', data: { target: a, other: b, id: null } });
    });
  }

  /**
   * Call after you've loaded all KMLs and populated this.feats.
   * Groups by file, builds an R-tree, then for each file-pair
   * drills into bbox-overlapping geoms and awaits the very first
   * worker hit. Emits the deduped map on result$.
   */
  public runOverlap(): void {
    this.computeOverlapByFileTree()
      .then(map => this._result$.next(map))
      .catch(err => this._result$.error(err));
  }

  /** internal: pulls from this.feats, does the R-tree + worker checks */
  private async computeOverlapByFileTree(): Promise<Record<string,string[]>> {
    const features = Array.from(this.feats.values());

    // 1) group features by KML filename
    const groups = new Map<string, FeatureRec[]>();
    for (const f of features) {
      (groups.get(f.name) || groups.set(f.name, []).get(f.name)!).push(f);
    }
    const files = Array.from(groups.keys());
    const result: Record<string,string[]> = {};
    files.forEach(n => (result[n] = []));

    // 2) build a global R-tree of all geometries’ bboxes
    const tree = new RBush<Entry>();
    tree.load(features.map(f => ({
      minX: f.bbox[0], minY: f.bbox[1],
      maxX: f.bbox[2], maxY: f.bbox[3],
      id:   f.id
    })));
    const idMap = new Map(features.map(f => [f.id, f] as const));
    const fileIds = new Map<string, Set<string>>();
    for (const name of files) {
      fileIds.set(name, new Set(groups.get(name)!.map(f=>f.id)));
    }

    // 3) for each file-pair, batch only bbox-overlapping geoms
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const A = files[i], B = files[j];
        let found = false;

        for (const ga of groups.get(A)!) {
          const hits = tree.search({
            minX: ga.bbox[0], minY: ga.bbox[1],
            maxX: ga.bbox[2], maxY: ga.bbox[3]
          });
          for (const h of hits) {
            if (!fileIds.get(B)!.has(h.id)) continue;
            const gb = idMap.get(h.id)!;

            // precise test in worker, bail on first true
            /* eslint-disable no-await-in-loop */
            if (await this.testIntersect(ga.geom, gb.geom)) {
              result[A].push(B);
              result[B].push(A);
              found = true;
            }
            /* eslint-enable */

            if (found) break;
          }
          if (found) break;
        }
      }
    }

    // 4) dedupe each file's array
    for (const k of files) {
      result[k] = Array.from(new Set(result[k]));
    }
    return result;
  }
}




// @Component({ /*…*/ })
// export class MyComp {
//   constructor(private overlap: OverlapService) {
//     // subscribe once
//     this.overlap.result$.subscribe(map => {
//       console.log('final overlap:', map);
//     });
//   }

//   onParseComplete() {
//     // if you’ve already called loadZip(...) and seen done$,
//     // just kick off overlap without passing anything in
//     this.overlap.runOverlap();
//   }
// }