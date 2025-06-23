// /// <reference lib="webworker" />

// import * as JSZip      from 'jszip';
// import { DOMParser }   from 'xmldom';
// import { flatten }     from '@turf/flatten';
// import bbox            from '@turf/bbox';
// import type { Feature } from 'geojson';

// declare var toGeoJSON:any;

// //"skipLibCheck": true
// addEventListener('message', async ({ data }) => {
//   if (data.type !== 'load') return;
//   const zip = await JSZip.loadAsync(data.file);
//   const kmlFiles = Object.values(zip.files)
//     .filter(f => f.name.toLowerCase().endsWith('.kml'));

//   let featureIndex = 0;
//   for (const file of kmlFiles) {
//     const xmlText = await file.async('text');
//     // parse KML → DOM → GeoJSON FeatureCollection
//     const dom     = new DOMParser().parseFromString(xmlText, 'application/xml');
//     const gj      = toGeoJSON.kml(dom) as GeoJSON.FeatureCollection;

//     // explode Multi* into single Geometries
//     const flat    = flatten(gj);

//     for (const feat of flat.features as Feature[]) {
//       // turf.bbox returns [minX, minY, maxX, maxY]
//       const bb = bbox(feat) as [number, number, number, number];

//       postMessage({
//         type:  'feature',
//         data: {
//           id:   `${file.name}#${featureIndex++}`,
//           name: file.name,
//           geom: feat.geometry,
//           bbox: bb
//         }
//       });
//     }
//   }

//   postMessage({ type: 'done' });
// });
// import *as JSZip              from 'jszip';
// import KML                from 'ol/format/KML';
// import GeoJSON            from 'ol/format/GeoJSON';
// import flatten            from '@turf/flatten';
// import turfBbox           from '@turf/bbox';
// import type { Feature }   from 'geojson';

// addEventListener('message', async ({ data }) => {
//   if (data.type !== 'load') return;

//   // 1) unzip the incoming .zip
//   const zip     = await JSZip.loadAsync(data.file);
//   const entries = Object.values(zip.files)
//     .filter(f => f.name.toLowerCase().endsWith('.kml'));

//   let featureIdx = 0;

//   // prepare OL formats
//   const kmlReader = new KML({
//     // ensure coordinates stay in lon/lat—no reprojection
//     extractStyles: false
//   });
//   const geoWriter = new GeoJSON();

//   for (const entry of entries) {
//     // 2) read KML text
//     const xmlText = await entry.async('text');

//     // 3) parse KML → array of ol.Feature
//     //    readFeatures accepts a string or Document
//     const olFeatures = kmlReader.readFeatures(xmlText, {
//       featureProjection: 'EPSG:4326'
//     });

//     // 4) convert to GeoJSON FeatureCollection
//     const gj = geoWriter.writeFeaturesObject(olFeatures) as GeoJSON.FeatureCollection;

//     // 5) explode any Multi* into atomic Features
//     const flat = flatten(gj);

//     // 6) emit each feature + its bbox
//     for (const feat of flat.features as Feature[]) {
//       const bb = turfBbox(feat) as [number,number,number,number];

//       postMessage({
//         type: 'feature',
//         data: {
//           id:   `${entry.name}#${featureIdx++}`,
//           name: entry.name,
//           geom: feat.geometry,
//           bbox: bb
//         }
//       });
//     }
//   }

//   postMessage({ type: 'done' });
// });
/// <reference lib="webworker" />
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import flatten from '@turf/flatten';
import turfBbox from '@turf/bbox';
import type {
  FeatureCollection,
  Feature,
  Geometry,
  GeoJsonProperties
} from 'geojson';

//
// --- KML→JS helper types & functions
//

/**
 * KmlGeom expresses each KML geometry as a strongly‐typed shape:
 *  - Point:        single [lon,lat]
 *  - LineString:   array of [lon,lat]
 *  - Polygon:      outer ring only: array of rings (each ring is array of [lon,lat])
 *  - MultiLineString: array of LineString coords
 *  - MultiPolygon: array of Polygon coords
 */
type KmlGeom =
  | { type: 'Point';            coords: [number,number] }
  | { type: 'LineString';       coords: [number,number][] }
  | { type: 'Polygon';          coords: [ [number,number][] ] }
  | { type: 'MultiLineString';  coords: [number,number][][]  }
  | { type: 'MultiPolygon';     coords: [ [number,number][] ][] };

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ''
});

// Parse a KML coords string "lon,lat lon,lat …" → array of [lon,lat]
function collectCoords(text: string): [number,number][] {
  return text
    .trim()
    .split(/\s+/)
    .map(s => {
      const [lon, lat] = s.split(',').map(Number);
      return [lon, lat] as [number,number];
    });
}

// Case-insensitive tag lookup (handles namespaces)
function findNode(obj: any, tagName: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const key = Object.keys(obj)
    .find(k => k.toLowerCase().endsWith(tagName.toLowerCase()));
  return key ? obj[key] : undefined;
}

// Recursively extract all KML geometries as KmlGeom[]
function extractGeoms(obj: any): KmlGeom[] {
  const out: KmlGeom[] = [];
  if (!obj) return out;

  // 1) Point
  const p = findNode(obj, 'Point')?.coordinates;
  if (p) {
    const pts = collectCoords(p);
    // take only the first for a true Point
    out.push({ type: 'Point', coords: pts[0] });
  }

  // 2) LineString
  const ls = findNode(obj, 'LineString')?.coordinates;
  if (ls) {
    out.push({ type: 'LineString', coords: collectCoords(ls) });
  }

  // 3) Polygon (outer ring only)
  const poly = findNode(obj, 'Polygon');
  const ring = poly?.outerBoundaryIs?.LinearRing?.coordinates;
  if (ring) {
    out.push({ type: 'Polygon', coords: [collectCoords(ring)] });
  }

  // 4) MultiGeometry → uniform MultiLineString or MultiPolygon
  const mg = findNode(obj, 'MultiGeometry');
  if (mg) {
    const lines = ([] as any[]).concat(mg.LineString || []);
    const polys = ([] as any[]).concat(mg.Polygon || []);
    const total = lines.length + polys.length;

    // MultiLineString
    if (lines.length === total && lines.length > 1) {
      const allLines: [number,number][][] = lines.map(l => collectCoords(l.coordinates));
      out.push({ type: 'MultiLineString', coords: allLines });
    }
    // MultiPolygon
    else if (polys.length === total && polys.length > 1) {
      // each poly → one ring of coords
      const allPolys: [ [number,number][] ][] = polys.map(p =>
        [collectCoords(p.outerBoundaryIs.LinearRing.coordinates)]
      );
      out.push({ type: 'MultiPolygon', coords: allPolys });
    }
    // mixed or singleton → recurse each child
    else {
      const children = [...lines, ...polys];
      for (const c of children) {
        out.push(...extractGeoms(c));
      }
    }

    // also recurse deeper
    out.push(...extractGeoms(mg));
  }

  // 5) Recursively dive into every object key
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'object') {
      out.push(...extractGeoms(val));
    }
  }

  return out;
}

//
// --- Worker message handler
//

addEventListener('message', async ({ data }) => {
  if (data.type !== 'load') return;

  // Unzip .zip → list of .kml entries
  const zip     = await JSZip.loadAsync(data.file);
  const entries = Object.values(zip.files)
    .filter(f => f.name.toLowerCase().endsWith('.kml'));

  let featCounter = 0;

  for (const entry of entries) {
    const xmlText = await entry.async('text');
    const jsObj   = xmlParser.parse(xmlText);

    // Extract our KmlGeom[] from the parsed XML
    const kmlGeoms = extractGeoms(jsObj.kml || jsObj);

    // Map each KmlGeom → a properly typed GeoJSON Feature
    const features: Feature<Geometry, GeoJsonProperties>[] = kmlGeoms.map((g, i) => {
      // cast coords into a GeoJSON Geometry
      const geometry: Geometry = {
        type: g.type,
        coordinates: g.coords as any
      };
      return {
        type: 'Feature',
        id:   `${entry.name}#${featCounter + i}`,
        properties: { name: entry.name },
        geometry
      };
    });

    // bump the global counter
    featCounter += features.length;

    // Build a strongly‐typed FeatureCollection
    const fc: FeatureCollection<Geometry, GeoJsonProperties> = {
      type: 'FeatureCollection',
      features
    };

    // Flatten any Multi* or GeometryCollections, compute bboxes, emit
    const flat = flatten(fc);
    (flat.features as Feature<Geometry>[]).forEach(feat => {
      const bb = turfBbox(feat) as [number,number,number,number];
      postMessage({
        type: 'feature',
        data: {
          id:   feat.id,
          name: entry.name,
          geom: feat.geometry,
          bbox: bb
        }
      });
    });
  }

  postMessage({ type: 'done' });
});


