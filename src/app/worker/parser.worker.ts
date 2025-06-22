/// <reference lib="webworker" />
import * as JSZip           from 'jszip';
import { DOMParser }   from 'xmldom';
import * as tj         from '@mapbox/togeojson';
import { flatten }     from '@turf/flatten';
import bbox            from '@turf/bbox';
import type { Feature } from 'geojson';
//"skipLibCheck": true
addEventListener('message', async ({ data }) => {
  if (data.type !== 'load') return;
  const zip = await JSZip.loadAsync(data.file);
  const kmlFiles = Object.values(zip.files)
    .filter(f => f.name.toLowerCase().endsWith('.kml'));

  let featureIndex = 0;
  for (const file of kmlFiles) {
    const xmlText = await file.async('text');
    // parse KML → DOM → GeoJSON FeatureCollection
    const dom     = new DOMParser().parseFromString(xmlText, 'application/xml');
    const gj      = tj.kml(dom) as GeoJSON.FeatureCollection;

    // explode Multi* into single Geometries
    const flat    = flatten(gj);

    for (const feat of flat.features as Feature[]) {
      // turf.bbox returns [minX, minY, maxX, maxY]
      const bb = bbox(feat) as [number, number, number, number];

      postMessage({
        type:  'feature',
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
