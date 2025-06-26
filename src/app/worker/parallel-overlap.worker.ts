/// <reference lib="webworker" />
import booleanIntersects from '@turf/boolean-intersects';

interface FeatureRec {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  geom: any;
}

// A single file-pair to test
interface Pair { A: string; B: string; }

// Message in: full features + a chunk of file-pairs
addEventListener('message', ({ data }) => {
  const { features, pairs } = data as {
    features: FeatureRec[];
    pairs: Pair[];
  };

  // build a quick id→FeatureRec map
  const idMap = new Map(features.map(f => [f.id, f] as const));
  // group features by name
  const groups = new Map<string, FeatureRec[]>();
  for (const f of features) {
    let arr = groups.get(f.name);
    if (!arr) { arr = []; groups.set(f.name, arr); }
    arr.push(f);
  }

  // compute partial overlaps
  const partial: Record<string,string[]> = {};
  for (const { A, B } of pairs) {
    outer: for (const ra of groups.get(A)!) {
      for (const rb of groups.get(B)!) {
        // fast bbox reject
        const [a1,a2,a3,a4] = ra.bbox;
        const [b1,b2,b3,b4] = rb.bbox;
        if (b1>a3||b3<a1||b2>a4||b4<a2) continue;
        // precise check
        if (booleanIntersects(
          { type:'Feature', properties:{}, geometry: ra.geom },
          { type:'Feature', properties:{}, geometry: rb.geom }
        )) {
          (partial[A] ||= []).push(B);
          (partial[B] ||= []).push(A);
          break outer;
        }
      }
    }
  }

  // send back the chunk result
  postMessage(partial);
});
