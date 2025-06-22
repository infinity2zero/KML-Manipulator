/// <reference lib="webworker" />
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

type KmlGeom =
  | { type: 'Point'; coordinates: [number,number] }
  | { type: 'MultiPoint'; coordinates: [number,number][] }
  | { type: 'LineString'; coordinates: [number,number][] }
  | { type: 'MultiLineString'; coordinates: [ [number,number][] ] }
  | { type: 'Polygon'; coordinates: [ [number,number][] ] }
  | { type: 'MultiPolygon'; coordinates: [ [ [number,number][] ] ] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ''
});

function extractGeoms(obj: any): KmlGeom[] {
  const out: KmlGeom[] = [];
  (function recurse(o: any) {
    // Point(s)
    if (o.Point?.coordinates) {
      const pts = o.Point.coordinates
        .trim()
        .split(/\s+/)
        .map((s: string) => {
          const [lon, lat] = s.split(',').map(Number);
          return [lon, lat] as [number,number];
        });
      out.push(
        pts.length === 1
          ? { type: 'Point', coordinates: pts[0] }
          : { type: 'MultiPoint', coordinates: pts }
      );
    }
    // LineString
    if (o.LineString?.coordinates) {
      const line = o.LineString.coordinates
        .trim()
        .split(/\s+/)
        .map((s: string) => {
          const [lon, lat] = s.split(',').map(Number);
          return [lon, lat] as [number,number];
        });
      out.push({ type: 'LineString', coordinates: line });
    }
    // Polygon (outer ring only)
    if (o.Polygon?.outerBoundaryIs?.LinearRing?.coordinates) {
      const ring = o.Polygon.outerBoundaryIs.LinearRing.coordinates
        .trim()
        .split(/\s+/)
        .map((s: string) => {
          const [lon, lat] = s.split(',').map(Number);
          return [lon, lat] as [number,number];
        });
      out.push({ type: 'Polygon', coordinates: [ring] });
    }
    // MultiGeometry
    if (o.MultiGeometry) {
      const geos = Array.isArray(o.MultiGeometry.Geometry)
        ? o.MultiGeometry.Geometry
        : o.MultiGeometry.Geometry
          ? [o.MultiGeometry.Geometry]
          : [];
      geos.forEach((g: any) => recurse({ [g['#name']]: g }));
      recurse(o.MultiGeometry);
    }
    // Placemark recursion
    if (o.Placemark) {
      const pls = Array.isArray(o.Placemark)
        ? o.Placemark
        : [o.Placemark];
      pls.forEach((p: any) => recurse(p));
    }
  })(obj.kml || obj);
  return out;
}

function flattenCoords(c: any): [number,number][] {
  if (!Array.isArray(c)) return [];
  if (c.length === 2 && typeof c[0] === 'number') {
    return [c as [number,number]];
  }
  return (c as any[]).flatMap(flattenCoords);
}

addEventListener('message', async ({ data }) => {
  if (data.type !== 'load') return;
  const zip = await JSZip.loadAsync(data.file);
  const entries = Object.values(zip.files)
    .filter(f => f.name.toLowerCase().endsWith('.kml'));
  let count = 0;
  for (const f of entries) {
    const xml = await f.async('text');
    const js = parser.parse(xml);
    const geoms = extractGeoms(js);
    for (const g of geoms) {
      const flat = flattenCoords(g.coordinates);
      if (!flat.length) continue;
      const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
      const bbox: [number,number,number,number] = [
        Math.min(...xs), Math.min(...ys),
        Math.max(...xs), Math.max(...ys)
      ];
      postMessage({
        type: 'feature',
        data: {
          id: `${f.name}#${count++}`,
          name: f.name,
          geom: g,
          bbox
        }
      });
    }
  }
  postMessage({ type: 'done' });
});
