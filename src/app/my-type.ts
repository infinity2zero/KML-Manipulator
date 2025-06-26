// your-types.ts
import type { Geometry } from 'geojson';

export interface FeatureRec {
  /** Unique identifier (e.g. "file.kml#3") */
  id: string;
  /** Human-readable name (e.g. "file.kml") */
  name: string;
  /** Any GeoJSON Geometry: Point, LineString, Polygon, etc. */
  geom: Geometry;
  /** [minX, minY, maxX, maxY] bounding box */
  bbox: [number, number, number, number];
}