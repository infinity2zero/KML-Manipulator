// overlap.service.ts
import { Injectable } from '@angular/core';
import { Subject }    from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class OverlapNewService {
  /** Streams parsed features and a done signal from parser.worker.ts */
  public feature$ = new Subject<FeatureRec>();
  public done$    = new Subject<void>();

  /** In‐memory store of all FeatureRecs as they arrive */
  private feats = new Map<string, FeatureRec>();

  /**
   * Launches parser.worker.ts in a WebWorker to unzip & parse KML → FeatureRec.
   * Emits each FeatureRec on feature$ and signals completion on done$.
   */
  loadZip(buffer: ArrayBuffer): void {
    JSZip.loadAsync(buffer).then(zip => {
      // kick off the worker
      const worker = new Worker(
        new URL('./worker/parser.worker', import.meta.url),
        { type: 'module' }
      );
      // send the raw buffer into the worker
      worker.postMessage({ type: 'load', file: buffer }, [buffer]);

      // listen for feature / done messages
      worker.onmessage = (evt: MessageEvent) => {
        const msg = evt.data as any;
        if (msg.type === 'feature') {
          const f = msg.data as FeatureRec;
          this.feats.set(f.id, f);
          this.feature$.next(f);
        }
        else if (msg.type === 'done') {
          this.done$.next();
          worker.terminate();
        }
      };
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
}
