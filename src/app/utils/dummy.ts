import *as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

type KmlGeom =
  | { type: 'Point'; coordinates: [number,number] }
  | { type: 'MultiPoint'; coordinates: [number,number][] }
  | { type: 'LineString'; coordinates: [number,number][] }
  | { type: 'MultiLineString'; coordinates: [ [number,number][] ] }
  | { type: 'Polygon'; coordinates: [ [number,number][] ] }
  | { type: 'MultiPolygon'; coordinates: [ [ [number,number][] ] ] };

const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'' });

/**
 * Extracts any KML geometry from an object, grouping
 * MultiGeometry of uniform types into explicit Multi*.
 */
function extractGeoms(obj: any): KmlGeom[] {
  const out: KmlGeom[] = [];

  (function recurse(o: any) {
    // 1) Point / MultiPoint
    if (o.Point?.coordinates) {
      const pts = o.Point.coordinates
        .trim().split(/\s+/)
        .map((s: string) => {
          const [lon,lat] = s.split(',').map(Number);
          return [lon,lat] as [number,number];
        });
      out.push(
        pts.length === 1
          ? { type:'Point',      coordinates: pts[0] }
          : { type:'MultiPoint', coordinates: pts }
      );
    }

    // 2) LineString
    if (o.LineString?.coordinates) {
      const line = o.LineString.coordinates
        .trim().split(/\s+/)
        .map((s: string) => {
          const [lon,lat] = s.split(',').map(Number);
          return [lon,lat] as [number,number];
        });
      out.push({ type:'LineString', coordinates: line });
    }

    // 3) Polygon (outer ring only)
    if (o.Polygon?.outerBoundaryIs?.LinearRing?.coordinates) {
      const ring = o.Polygon.outerBoundaryIs.LinearRing.coordinates
        .trim().split(/\s+/)
        .map((s: string) => {
          const [lon,lat] = s.split(',').map(Number);
          return [lon,lat] as [number,number];
        });
      out.push({ type:'Polygon', coordinates: [ ring ] });
    }

    // 4) MultiGeometry grouping
    if (o.MultiGeometry) {
      const geos = Array.isArray(o.MultiGeometry.Geometry)
        ? o.MultiGeometry.Geometry
        : o.MultiGeometry.Geometry
          ? [o.MultiGeometry.Geometry]
          : [];

      // detect uniform type
      const isAllLines = geos.every((g:any) => g.LineString);
      const isAllPolys = geos.every((g:any) => g.Polygon?.outerBoundaryIs);

      if (isAllLines) {
        // collect all LineString coords
        const coords = geos.map((g:any) =>
          g.LineString.coordinates
            .trim().split(/\s+/)
            .map((s:string) => {
              const [lon,lat] = s.split(',').map(Number);
              return [lon,lat] as [number,number];
            })
        );
        out.push({ type:'MultiLineString', coordinates: coords });
      }
      else if (isAllPolys) {
        // collect all Polygon outer rings
        const coords = geos.map((g:any) =>
          g.Polygon.outerBoundaryIs.LinearRing.coordinates
            .trim().split(/\s+/)
            .map((s:string) => {
              const [lon,lat] = s.split(',').map(Number);
              return [lon,lat] as [number,number];
            })
        );
        out.push({ type:'MultiPolygon', coordinates: coords.map((ring:any) => [ring]) });
      }
      else {
        // mixed or unknown: recurse each entry
        geos.forEach((g:any) => recurse({ [g['#name']]: g }));
      }

      // Also catch nested geometry children
      recurse(o.MultiGeometry);
    }

    // 5) Placemark recursion
    if (o.Placemark) {
      const pls = Array.isArray(o.Placemark) ? o.Placemark : [o.Placemark];
      pls.forEach((p:any) => recurse(p));
    }
  })(obj.kml || obj);

  return out;
}
