/// <reference lib="webworker" />
import booleanIntersects from '@turf/boolean-intersects';
import { FeatureRec } from '../my-type';
import RBush          from 'rbush';


interface Box { minX:number; minY:number; maxX:number; maxY:number }

addEventListener('message', ({ data }) => {
    let _data = new Map<String, FeatureRec>(JSON.parse(data));
    
    const all:FeatureRec[] = Array.from(_data.values());
    const result = computeOverlapByFile(all);
    console.log('CHECKING INTERSECTION FROM WORKER');
    
    postMessage({ type: 'result', overlaps: result });
});

function computeOverlapByFile(features: FeatureRec[]): Record<string,string[]> {
    let t1 = performance.now();
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
    let t2 = performance.now();
    console.log('time taken to FIND OVERLAP IN WORKER THREAD', (t2 - t1) / 1000 + 's');
    return result;
}




function computeOverlapByFileTree(features: FeatureRec[]): Record<string,string[]> {
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
  