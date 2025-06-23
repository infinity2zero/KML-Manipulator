// This file is loaded into each Worker via `new Worker(..., { type:'module' })`
import booleanIntersects from '@turf/boolean-intersects';

interface MsgIn {
  type: 'batchCheck';
  id:    number;
  pairs: [GeoJSON.Geometry,GeoJSON.Geometry][];
}

interface MsgOut {
  type: 'batchResult';
  id:    number;
  hit:   boolean;
}

addEventListener('message', (evt: MessageEvent) => {
  const { type, id, pairs } = evt.data as MsgIn;
  if (type !== 'batchCheck') return;

  let hit = false;
  for (const [g1, g2] of pairs) {
    // wrap in a Feature so Turf accepts it
    const f1 = { type:'Feature', properties:{}, geometry: g1 };
    const f2 = { type:'Feature', properties:{}, geometry: g2 };
    if (booleanIntersects(f1, f2)) {
      hit = true;
      break;
    }
  }

  const res: MsgOut = { type:'batchResult', id, hit };
  postMessage(res);
});
