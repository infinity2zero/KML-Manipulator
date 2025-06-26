import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
// import { FeatureRec } from './parallel-flatbush.worker';
interface Pair { A: string; B: string; }
export interface FeatureRec {
    id: string;
    name: string;
    bbox: [number, number, number, number];
    geom: any;
}

// interface Pair { A: string; B: string; }

@Injectable({ providedIn: 'root' })
export class OverlapParallelFlatbushService {
    compute(
        features: FeatureRec[],
        onProgress?: (p: number) => void
    ): Observable<Record<string, string[]>> {
        return new Observable(sub => {
            // A) build half‐matrix of file‐pairs
            const files = Array.from(new Set(features.map(f => f.name)));
            const pairs: Pair[] = [];
            for (let i = 0; i < files.length; i++) {
                for (let j = i + 1; j < files.length; j++) {
                    pairs.push({ A: files[i], B: files[j] });
                }
            }

            // B) chunk into N slices
            const N = navigator.hardwareConcurrency || 4;
            const size = Math.ceil(pairs.length / N);
            const chunks: Pair[][] = [];
            for (let i = 0; i < pairs.length; i += size) {
                chunks.push(pairs.slice(i, i + size));
            }

            // C) launch a worker per chunk
            let done = 0;
            const final: Record<string, string[]> = {};
            files.forEach(f => final[f] = []);

            for (const chunk of chunks) {
                const worker = new Worker(
                    new URL('./worker/parallel-flatbush.worker', import.meta.url),
                    { type: 'module' }
                );
                type PartialResult = Record<string, string[]>;
                worker.onmessage = ({ data }) => {
                    // merge partial
                    const partial: PartialResult = data;
                    for (const [file, overlaps] of Object.entries(partial)) {
                        final[file].push(...overlaps);
                    }
                    worker.terminate();
                    if (++done && onProgress) onProgress(done / chunks.length);
                    if (done === chunks.length) {
                        // dedupe & sort
                        for (const k of Object.keys(final)) {
                            final[k] = Array.from(new Set(final[k])).sort();
                        }
                        sub.next(final);
                        sub.complete();
                    }
                };
                worker.onerror = err => sub.error(err);
                // send features + this chunk
                worker.postMessage({ features, pairs: chunk });
            }
        });
    }
}
