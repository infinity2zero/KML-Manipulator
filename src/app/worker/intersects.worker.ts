/// <reference lib="webworker" />
import booleanIntersects from '@turf/boolean-intersects';


addEventListener('message', ({ data }) => {
  if (data.type !== 'check') return;
  const hit = booleanIntersects(data.data.target, data.data.other);
  postMessage({ type: 'result', data: { hit, id: data.data.id } });
});
