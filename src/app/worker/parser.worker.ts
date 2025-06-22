/// <reference lib="webworker" />
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { extractPolygons } from '../utils/extract-polygons';

// messages:
// { type: 'load', file: ArrayBuffer }
// → stream back { type:'feature', data: { id, name, bbox, geom } }
// → when done → { type:'done' }
const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'' });

addEventListener('message', async ({ data }) => {
  if (data.type !== 'load') return;
  const zip = await JSZip.loadAsync(data.file);
  const entries = Object.values(zip.files).filter(f => f.name.toLowerCase().endsWith('.kml'));
  let count = 0;
  for (const f of entries) {
    const xml = await f.async('text');
    const obj = parser.parse(xml);
    const rings = extractPolygons(obj);
    if (!rings.length) continue;
    // build simple GeoJSON-ish
    const geom = (rings.length === 1)
      ? { type:'Polygon', coordinates: [rings[0]] }
      : { type:'MultiPolygon', coordinates: rings.map(r=>[r]) };
    // compute bbox
    const flat = rings.flat();
    const xs = flat.map(p=>p[0]), ys = flat.map(p=>p[1]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // emit
    postMessage({
      type:'feature',
      data: {
        id: `${Date.now()}-${count++}`,
        name: f.name,
        geom,
        bbox
      }
    });
  }
  postMessage({ type:'done' });
});
