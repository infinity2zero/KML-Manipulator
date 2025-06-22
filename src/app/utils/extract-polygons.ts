// Recursively extracts [ [ [lng,lat],… ] ] rings from KML AST
export function extractPolygons(obj: any): number[][][] {
  const arr: number[][][] = [];
  (function recurse(o: any) {
    if (o.Placemark) {
      const pls = Array.isArray(o.Placemark) ? o.Placemark : [o.Placemark];
      pls.forEach((p:any) => recurse(p));
    }
    if (o.Polygon?.outerBoundaryIs) {
      const raw = o.Polygon.outerBoundaryIs.LinearRing.coordinates.trim();
      const coords = raw.split(/\s+/).map((s:any) => s.split(',').map(Number));
      arr.push(coords);
    }
    if (o.MultiGeometry) recurse(o.MultiGeometry);
  })(obj.kml || obj);
  return arr;
}
