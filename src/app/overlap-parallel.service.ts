// overlap-parallel.service.ts
import { Injectable } from '@angular/core';
import { Observable, Subscriber } from 'rxjs';
import { FeatureRec } from './overlap.service'; // reuse your type

interface Pair { A: string; B: string; }
type Partial = Record<string,string[]>;

@Injectable({ providedIn: 'root' })
export class OverlapParallelService {
  /** 
   * Compute overlaps in parallel. 
   * @param features all FeatureRecs
   * @param onProgress optional callback 0→1
   */
  compute(
    features: FeatureRec[],
    onProgress?: (p: number) => void
  ): Observable<Record<string,string[]>> {
    return new Observable((sub: Subscriber<any>) => {
      // 1) group & gather file-names
      const files = Array.from(new Set(features.map(f => f.name)));
      // 2) generate half-matrix file pairs
      const pairs: Pair[] = [];
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          pairs.push({ A: files[i], B: files[j] });
        }
      }

      // 3) chunk them across N workers
      const N = navigator.hardwareConcurrency || 4;
      const chunkSize = Math.ceil(pairs.length / N);
      const chunks = [];
      for (let i = 0; i < pairs.length; i += chunkSize) {
        chunks.push(pairs.slice(i, i + chunkSize));
      }

      // 4) launch workers
      let done = 0;
      const final: Record<string,string[]> = {};
      for (const f of files) final[f] = [];

      chunks.forEach(chunk => {
        const worker = new Worker(
          new URL('./worker/parallel-overlap.worker', import.meta.url),
          { type: 'module' }
        );
        worker.onmessage = ({ data }: MessageEvent<Partial>) => {
          // merge partial result
          for (const [k, arr] of Object.entries(data)) {
            final[k].push(...arr);
          }
          worker.terminate();
          done++;
          onProgress?.(done / chunks.length);
          if (done === chunks.length) {
            // dedupe + sort
            for (const k of Object.keys(final)) {
              final[k] = Array.from(new Set(final[k])).sort();
            }
            sub.next(final);
            sub.complete();
          }
        };
        worker.onerror = err => sub.error(err);

        // send the worker its chunk
        worker.postMessage({ features, pairs: chunk });
      });
    });
  }
}

/**
 * 
 * this.overlapSvc.compute(features, p=> this.progress = p)
  .subscribe(res => this.overlaps = res);

 */
