/// <reference lib="webworker" />
import Flatbush from 'flatbush';
import booleanIntersects from '@turf/boolean-intersects';

export interface FeatureRec {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  geom: any;
}

interface Pair { A: string; B: string; }

addEventListener('message', ({ data }) => {
  const { features, pairs } = data as {
    features: FeatureRec[];
    pairs: Pair[];
  };

  // 1) Group features by filename
  const groups = new Map<string, FeatureRec[]>();
  for (const f of features) {
    let arr = groups.get(f.name);
    if (!arr) { arr = []; groups.set(f.name, arr); }
    arr.push(f);
  }

  // 2) Compute each file’s big‐bbox (envelope)
  const fileBoxes = new Map<string, {minX:number;minY:number;maxX:number;maxY:number;}>();
  for (const [name, recs] of groups) {
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const r of recs) {
      const [x1,y1,x2,y2] = r.bbox;
      minX = Math.min(minX,x1);
      minY = Math.min(minY,y1);
      maxX = Math.max(maxX,x2);
      maxY = Math.max(maxY,y2);
    }
    fileBoxes.set(name, {minX,minY,maxX,maxY});
  }

  // 3) Bulk‐load Flatbush
  const tree = new Flatbush(features.length);
  features.forEach(f =>
    tree.add(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3])
  );
  tree.finish();

  // 4) Build id→FeatureRec map
  const idMap = new Map(features.map(f => [f.id, f] as const));

  // 5) Test each pair, early‐exit on first hit
  const partial: Record<string,string[]> = {};
  for (const {A,B} of pairs) {
    const boxA = fileBoxes.get(A)!;
    const boxB = fileBoxes.get(B)!;

    // 5a) file‐envelope reject
    if (
      boxB.minX > boxA.maxX || boxB.maxX < boxA.minX ||
      boxB.minY > boxA.maxY || boxB.maxY < boxA.minY
    ) continue;

    // 5b) single Flatbush search on A’s envelope
    const idxs = tree.search(
      boxA.minX, boxA.minY, boxA.maxX, boxA.maxY
    );

    // 5c) filter to B’s feature‐ids
    const bSet = new Set(groups.get(B)!.map(r => r.id));
    const bRecs = idxs
      .map(i => idMap.get(features[i].id)!)
      .filter(r => bSet.has(r.id));

    // 5d) precise check
    outer: for (const ra of groups.get(A)!) {
      for (const rb of bRecs) {
        const featA:any = { type:'Feature', properties:{}, geometry: ra.geom };
        const featB:any = { type:'Feature', properties:{}, geometry: rb.geom };
        if (booleanIntersects(featA, featB)) {
          (partial[A] ||= []).push(B);
          (partial[B] ||= []).push(A);
          break outer;
        }
      }
    }
  }

  postMessage(partial);
});
