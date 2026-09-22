export type MapPoint = { lat: number; lng: number };

/** Decode Google's compact route format without loading the browser geometry library. */
export function decodeGooglePolyline(encoded: string): MapPoint[] {
  const points: MapPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return points;
}

export function routePointKey(point: MapPoint | null) {
  return point ? `${point.lat.toFixed(3)},${point.lng.toFixed(3)}` : "none";
}