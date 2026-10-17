// Plain booking map: pickup/drop pins and an optional route line. No riders.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed, MapPin } from "lucide-react";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import { decodeGooglePolyline } from "@/lib/mapRoute";
import { fetchTrackingRoadRoute } from "@/lib/trackingRoute.functions";
import { getCurrentCoords } from "@/lib/nativeGeolocation";

export type MapPin = { lat: number; lng: number; kind: "pickup" | "drop" };

function pinIcon(kind: "pickup" | "drop") {
  const g = window.google.maps;
  return {
    path: g.SymbolPath.CIRCLE,
    scale: 8,
    fillColor: kind === "pickup" ? "#00B97A" : "#E5484D",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

export function ParcelMap({
  pins,
  showRoute = false,
  showMyLocation = false,
  signedIn = false,
  className = "",
}: {
  pins: MapPin[];
  showRoute?: boolean;
  showMyLocation?: boolean;
  signedIn?: boolean;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const meRef = useRef<any>(null);
  const key = pins.map((p) => `${p.kind}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");

  const first = pins.find((p) => p.kind === "pickup");
  const last = [...pins].reverse().find((p) => p.kind === "drop");
  const { data: road } = useQuery({
    queryKey: ["parcel-route", key],
    queryFn: () =>
      fetchTrackingRoadRoute({
        data: { origin: { lat: first!.lat, lng: first!.lng }, destination: { lat: last!.lat, lng: last!.lng }, mode: "TWO_WHEELER" },
      }),
    enabled: showRoute && signedIn && pins.length === 2 && !!first && !!last,
    staleTime: 30 * 60_000,
    retry: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadMapsScript()
      .then(() => {
        if (cancelled || !divRef.current || !window.google?.maps) return;
        mapRef.current = new window.google.maps.Map(divRef.current, {
          center: pins[0] ?? { lat: 18.4088, lng: 76.5604 },
          zoom: 15,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const g = window.google.maps;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = pins.map((p) => new g.Marker({ position: p, map, icon: pinIcon(p.kind), clickable: false }));
    if (showRoute && pins.length >= 2) {
      const path = road?.encodedPolyline ? decodeGooglePolyline(road.encodedPolyline) : pins;
      overlays.current.push(
        new g.Polyline({ path, map, strokeColor: "#00B97A", strokeOpacity: 0.9, strokeWeight: 4, geodesic: true }),
      );
      const b = new g.LatLngBounds();
      path.forEach((p: { lat: number; lng: number }) => b.extend(p));
      map.fitBounds(b, 56);
    } else if (pins[0]) {
      map.panTo(pins[0]);
      map.setZoom(16);
    }
  }, [ready, key, road, showRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = async () => {
    try {
      const c = await getCurrentCoords();
      const map = mapRef.current;
      if (!map) return;
      const pos = { lat: c.lat, lng: c.lng };
      const g = window.google.maps;
      if (meRef.current) meRef.current.setPosition(pos);
      else
        meRef.current = new g.Marker({
          position: pos,
          map,
          clickable: false,
          zIndex: 999,
          icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: "#2563EB", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 },
        });
      map.panTo(pos);
      map.setZoom(16);
    } catch {
      /* permission denied: keep current view */
    }
  };

  return (
    <div className={`relative overflow-hidden bg-muted ${className}`}>
      <div ref={divRef} className="absolute inset-0" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <MapPin className="h-8 w-8" />
        </div>
      )}
      {showMyLocation && (
        <button
          type="button"
          onClick={() => void locate()}
          aria-label="My location"
          className="absolute bottom-8 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-card text-primary shadow-card-m"
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
