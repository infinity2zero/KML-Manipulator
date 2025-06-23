import { Injectable } from '@angular/core';

interface Task {
  id:    number;
  pairs: [GeoJSON.Geometry,GeoJSON.Geometry][];
  resolve: (hit: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class IntersectPoolService {
  private pool: Worker[] = [];
  private queue: Task[]  = [];
  private tasks = new Map<number, Task>();
  private nextId = 1;

  constructor() {
    // spawn one Worker per CPU core
    const cores = navigator.hardwareConcurrency || 4;
    for (let i = 0; i < cores; i++) {
      const w = new Worker(
        new URL('../worker/intersectsV2.worker', import.meta.url),
        { type: 'module' }
      );
      (w as any).busy = false;
      w.onmessage = (evt: MessageEvent) => {
        const { id, hit } = evt.data as { id: number; hit: boolean };
        const task = this.tasks.get(id)!;
        task.resolve(hit);
        this.tasks.delete(id);
        (w as any).busy = false;
        this.dispatchNext();
      };
      this.pool.push(w);
    }
  }

  /** Queue up a batch of geometry‐pairs. Resolves true on first intersection. */
  public anyIntersect(
    pairs: [GeoJSON.Geometry,GeoJSON.Geometry][]
  ): Promise<boolean> {
    return new Promise(resolve => {
      const id = this.nextId++;
      const task: Task = { id, pairs, resolve };
      this.queue.push(task);
      this.dispatchNext();
    });
  }

  /** Try to assign queued tasks to any free workers. */
  private dispatchNext() {
    for (const w of this.pool) {
      if (this.queue.length === 0) break;
      if ((w as any).busy) continue;

      const task = this.queue.shift()!;
      this.tasks.set(task.id, task);
      (w as any).busy = true;
      w.postMessage({ type: 'batchCheck', id: task.id, pairs: task.pairs });
    }
  }
}
