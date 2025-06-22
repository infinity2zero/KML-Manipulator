// src/app/utils/extract-geoms.ts
export type KmlGeom =
  | { type: 'Point'; coordinates: [number,number] }
  | { type: 'MultiPoint'; coordinates: [number,number][] }
  | { type: 'LineString'; coordinates: [number,number][] }
  | { type: 'MultiLineString'; coordinates: [ [number,number][] ] }
  | { type: 'Polygon'; coordinates: [ [number,number][] ] }
  | { type: 'MultiPolygon'; coordinates: [ [ [number,number][] ] ] }

export function extractGeoms(obj: any): KmlGeom[] {
  const out: KmlGeom[] = []

  ;(function recurse(o: any) {
    // Point
    if (o.Point?.coordinates) {
      const arr = o.Point.coordinates.trim().split(/\s+/).map((s:any) =>
        s.split(',').slice(0,2).map(Number) as [number,number]
      )
      if (arr.length === 1) out.push({ type: 'Point', coordinates: arr[0] })
      else out.push({ type: 'MultiPoint', coordinates: arr })
    }

    // LineString
    if (o.LineString?.coordinates) {
      const arr = o.LineString.coordinates.trim().split(/\s+/).map((s:any) =>
        s.split(',').slice(0,2).map(Number) as [number,number]
      )
      out.push({ type: 'LineString', coordinates: arr })
    }

    // Polygon
    if (o.Polygon?.outerBoundaryIs) {
      const arr = o.Polygon.outerBoundaryIs.LinearRing.coordinates.trim()
        .split(/\s+/)
        .map((s:any) => s.split(',').slice(0,2).map(Number) as [number,number])
      out.push({ type: 'Polygon', coordinates: [arr] })
    }

    // MultiGeometry
    if (o.MultiGeometry) {
      recurse(o.MultiGeometry)
    }

    // Placemark
    if (o.Placemark) {
      const pls = Array.isArray(o.Placemark) ? o.Placemark : [o.Placemark]
      pls.forEach((p:any) => recurse(p))
    }
  })(obj.kml || obj)

  return out
}
