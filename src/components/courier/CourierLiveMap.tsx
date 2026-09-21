// Live parcel map: pickup pin, drop pin and the rider's moving marker.
// Rider coordinates come from an owner-only server RPC that is rate limited,
// so we poll gently and only while the order is actually on the move.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import { fetchRiderLocation } from "./courierData";

const LIVE_STATUSES = ["DRIVER_ASSIGNED", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT"];

function agoLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

export function CourierLiveMap({
  orderId,
  status,
  pickup,
  drop,
}: {
  orderId: string;
  status: string;
  pickup: { lat: number | null; lng: number | null; label: string };
  drop: { lat: number | null; lng: number | null; label: string };
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const riderMarkerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const failedRef = useRef(false);
  const [, force] = useForceRender();

  const live = LIVE_STATUSES.includes(status);
  const hasPickup = pickup.lat != null && pickup.lng != null;
  const hasDrop = drop.lat != null && drop.lng != null;
  const hasAny = hasPickup || hasDrop;

  const { data: rider } = useQuery({
    queryKey: ["courier-rider-location", orderId],
    queryFn: () => fetchRiderLocation(orderId),
    enabled: live,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const riderPos =
    rider?.available && rider.lat != null && rider.lng != null && !rider.stale
      ? { lat: Number(rider.lat), lng: Number(rider.lng) }
      : null;

  // Create the map once we have at least one coordinate.
  useEffect(() => {
    if (!hasAny) return;
    let cancelled = false;
    loadMapsScript()
      .then(() => {
        if (cancelled || !mapDivRef.current || !window.google?.maps) return;
        const center = hasPickup
          ? { lat: Number(pickup.lat), lng: Number(pickup.lng) }
          : { lat: Number(drop.lat), lng: Number(drop.lng) };
        const map = new window.google.maps.Map(mapDivRef.current, {
          center,
          zoom: 14,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        if (hasPickup) {
          new window.google.maps.Marker({
            position: { lat: Number(pickup.lat), lng: Number(pickup.lng) },
            map,
            title: "Pickup",
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#00B97A",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });
        }
        if (hasDrop) {
          new window.google.maps.Marker({
            position: { lat: Number(drop.lat), lng: Number(drop.lng) },
            map,
            title: "Drop",
            icon: {
              path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
              scale: 5,
              fillColor: "#20242D",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
          });
        }
        if (hasPickup && hasDrop) {
          new window.google.maps.Polyline({
            path: [
              { lat: Number(pickup.lat), lng: Number(pickup.lng) },
              { lat: Number(drop.lat), lng: Number(drop.lng) },
            ],
            map,
            strokeColor: "#00B97A",
            strokeOpacity: 0.5,
            strokeWeight: 3,
          });
          const b = new window.google.maps.LatLngBounds();
          b.extend({ lat: Number(pickup.lat), lng: Number(pickup.lng) });
          b.extend({ lat: Number(drop.lat), lng: Number(drop.lng) });
          map.fitBounds(b, 50);
        }
        mapRef.current = map;
        readyRef.current = true;
        force();
      })
      .catch(() => {
        if (cancelled) return;
        failedRef.current = true;
        force();
      });
    return () => {
      cancelled = true;
      mapRef.current = null;
      riderMarkerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAny, hasPickup, hasDrop, pickup.lat, pickup.lng, drop.lat, drop.lng]);

  // Move the rider marker as fresh coordinates arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.google?.maps) return;

    if (!riderPos) {
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      return;
    }

    if (!riderMarkerRef.current) {
      riderMarkerRef.current = new window.google.maps.Marker({
        position: riderPos,
        map,
        title: "Rider",
        zIndex: 10,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#0B7CFF",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 4,
        },
      });
    } else {
      riderMarkerRef.current.setPosition(riderPos);
    }

    const target =
      status === "PICKED_UP" || status === "IN_TRANSIT"
        ? { lat: Number(drop.lat), lng: Number(drop.lng) }
        : { lat: Number(pickup.lat), lng: Number(pickup.lng) };
    if (Number.isFinite(target.lat) && Number.isFinite(target.lng)) {
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend(target);
      bounds.extend(riderPos);
      map.fitBounds(bounds, 70);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderPos?.lat, riderPos?.lng, status]);

  let note: string;
  if (!live) {
    note = "Live tracking starts once a rider accepts your parcel.";
  } else if (riderPos && rider?.location_updated_at) {
    note = `Rider location updated ${agoLabel(rider.location_updated_at)}.`;
  } else if (rider?.location_updated_at) {
    note = `Rider location paused — last seen ${agoLabel(rider.location_updated_at)}.`;
  } else {
    note = "Waiting for the rider's location…";
  }

  const showMap = hasAny && !failedRef.current;

  return (
    <section className="overflow-hidden rounded-[20px] border border-border bg-card shadow-sm">
      <div className="relative h-60 w-full bg-muted">
        {showMap ? (
          <>
            <div ref={mapDivRef} className="h-full w-full" />
            {!readyRef.current && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <MapPin className="h-10 w-10 text-primary/60" />
              </div>
            )}
            {live && (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/95 px-3 py-1.5 text-[11px] font-semibold shadow">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    riderPos ? "animate-pulse bg-primary" : "bg-muted-foreground"
                  }`}
                />
                {riderPos ? "Live" : "Connecting…"}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 text-center">
            <Navigation className="h-10 w-10 text-primary" />
            <div className="mt-2 text-xs font-medium text-muted-foreground">
              Map preview unavailable
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground">
        {note}
      </div>
    </section>
  );
}

/** Tiny re-render helper so map readiness can live in refs. */
function useForceRender(): [number, () => void] {
  const ref = useRef(0);
  const setRef = useRef<((n: number) => void) | null>(null);
  const [n, setN] = useStateShim(0);
  setRef.current = setN;
  return [n, () => setRef.current?.(++ref.current)];
}

// Local import kept at the bottom so the helper above reads cleanly.
import { useState as useStateShim } from "react";
