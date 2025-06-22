/// <reference lib="webworker"/>
import * as JSZip     from 'jszip';
// import { XMLParser } from 'fast-xml-parser';
const tj: any = require('@mapbox/togeojson');
import { DOMParser } from 'xmldom';
import { flatten, bbox as turfBbox } from '@turf/turf';

addEventListener('message', async ({ data }) => {
  if (data.type !== 'load') return;
  const zip = await JSZip.loadAsync(data.file);
  const kmlFiles = Object.values(zip.files).filter(f => f.name.toLowerCase().endsWith('.kml'));

  let featureIndex = 0;
  for (const file of kmlFiles) {
    const xmlText = await file.async('text');
    const dom     = new DOMParser().parseFromString(xmlText, 'application/xml');
    const geojson = tj.kml(dom) as GeoJSON.FeatureCollection;

    // flatten will spit out Features for Point, LineString, Polygon, Multi*, etc.
    const flat = flatten(geojson);

    for (const feat of flat.features) {
      // turfBbox returns [minX,minY,maxX,maxY]
      const bb = turfBbox(feat) as [number,number,number,number];

      postMessage({
        type: 'feature',
        data: {
          id:   `${file.name}#${featureIndex++}`,
          name: file.name,
          geom: feat.geometry,
          bbox: bb
        }
      });
    }
  }
  postMessage({ type: 'done' });
});
