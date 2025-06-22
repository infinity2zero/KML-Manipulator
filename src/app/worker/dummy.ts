/**
 * Synchronous O(N²) version that returns
 * { [kmlName]: string[] }
 */
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
      const A = { type: 'Feature', properties: {}, geometry: features[i].geom };
      const B = { type: 'Feature', properties: {}, geometry: features[j].geom };

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

      const A = { type: 'Feature', properties: {}, geometry: features[e.idx].geom };
      const B = { type: 'Feature', properties: {}, geometry: features[h.idx].geom };

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


// after your parser.worker.ts has filled `this.feats`
const all = Array.from(this.feats.values());

// 1) naive JSON
const json1 = this.overlapService.computeOverlapJson(all);
// 2) R-tree optimized JSON
const json2 = this.overlapService.computeOverlapJsonTree(all);

console.log(JSON.stringify(json2, null, 2));
