/// <reference lib="webworker" />
import booleanIntersects from '@turf/boolean-intersects';
addEventListener('message', ({ data }) => {
  if (data.type !== 'check') return;
  console.log('intersect parser',data.data.target, data.data.other);
  const hit = booleanIntersects(data.data.target, data.data.other);
  postMessage({ type: 'result', data: { hit, id: data.data.id } });
});
