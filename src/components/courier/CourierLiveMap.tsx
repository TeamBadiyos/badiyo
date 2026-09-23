// Live parcel map: pickup pin, drop pin and the rider's moving marker.
// Rider coordinates come from an owner-only server RPC that is rate limited,
// so we poll gently and only while the order is actually on the move.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import { decodeGooglePolyline, routePointKey } from "@/lib/mapRoute";
import { fetchTrackingRoadRoute } from "@/lib/trackingRoute.functions";
import riderMarkerImage from "@/assets/map-rider-worker.png";
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
  const routeLineRef = useRef<any>(null);
  const baseLineRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(false);
  const markReady = useCallback(() => {
    readyRef.current = true;
    setReady(true);
  }, []);

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

  // Keep showing the last known rider position even when it goes stale —
  // an empty map reads as "tracking is broken".
  const riderPos =
    rider?.available && rider.lat != null && rider.lng != null
      ? { lat: Number(rider.lat), lng: Number(rider.lng) }
      : null;
  const riderStale = !!rider?.stale;
  const pickupPoint = hasPickup
    ? { lat: Number(pickup.lat), lng: Number(pickup.lng) }
    : null;
  const dropPoint = hasDrop ? { lat: Number(drop.lat), lng: Number(drop.lng) } : null;
  const target =
    status === "PICKED_UP" || status === "IN_TRANSIT" ? dropPoint : pickupPoint;

  // Base route (pickup -> drop) is always drawn, with or without a rider.
  const { data: baseRoute } = useQuery({
    queryKey: [
      "courier-base-route",
      orderId,
      routePointKey(pickupPoint),
      routePointKey(dropPoint),
    ],
    queryFn: () =>
      fetchTrackingRoadRoute({
        data: {
          origin: pickupPoint as { lat: number; lng: number },
          destination: dropPoint as { lat: number; lng: number },
          mode: "TWO_WHEELER",
        },
      }),
    enabled: !!pickupPoint && !!dropPoint,
    staleTime: 30 * 60_000,
    retry: false,
  });

  const routeOriginKey = routePointKey(riderPos);
  const routeTargetKey = routePointKey(target);
  const { data: roadRoute } = useQuery({
    queryKey: ["courier-road-route", orderId, routeOriginKey, routeTargetKey, status],
    queryFn: () =>
      fetchTrackingRoadRoute({
        data: { origin: riderPos as { lat: number; lng: number }, destination: target as { lat: number; lng: number }, mode: "TWO_WHEELER" },
      }),
    enabled: live && !!riderPos && !!target,
    staleTime: 2 * 60_000,
    retry: false,
  });

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
          const b = new window.google.maps.LatLngBounds();
          b.extend({ lat: Number(pickup.lat), lng: Number(pickup.lng) });
          b.extend({ lat: Number(drop.lat), lng: Number(drop.lng) });
          map.fitBounds(b, 50);
        }
        mapRef.current = map;
        markReady();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      mapRef.current = null;
      riderMarkerRef.current = null;
      routeLineRef.current = null;
      baseLineRef.current = null;
      readyRef.current = false;
      setReady(false);
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

    const icon = {
      url: riderMarkerImage,
      scaledSize: new window.google.maps.Size(58, 58),
      anchor: new window.google.maps.Point(29, 55),
    };
    if (!riderMarkerRef.current) {
      riderMarkerRef.current = new window.google.maps.Marker({
        position: riderPos,
        map,
        title: "Rider",
        zIndex: 10,
        opacity: riderStale ? 0.55 : 1,
        icon,
      });
    } else {
      riderMarkerRef.current.setPosition(riderPos);
      riderMarkerRef.current.setOpacity(riderStale ? 0.55 : 1);
    }

    if (target && Number.isFinite(target.lat) && Number.isFinite(target.lng)) {
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend(target);
      bounds.extend(riderPos);
      map.fitBounds(bounds, 70);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, riderPos?.lat, riderPos?.lng, riderStale, status]);

  // Faint pickup -> drop route, always visible.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;
    baseLineRef.current?.setMap(null);
    baseLineRef.current = null;
    if (!pickupPoint || !dropPoint) return;

    const decoded = baseRoute?.encodedPolyline
      ? decodeGooglePolyline(baseRoute.encodedPolyline)
      : [];
    const usingRoad = decoded.length >= 2;
    const path = usingRoad ? decoded : [pickupPoint, dropPoint];
    baseLineRef.current = new window.google.maps.Polyline({
      path,
      map,
      strokeColor: "#00B97A",
      strokeOpacity: usingRoad ? 0.45 : 0,
      strokeWeight: 4,
      zIndex: 1,
      ...(usingRoad
        ? {}
        : {
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 0.55,
                  strokeColor: "#00B97A",
                  scale: 3,
                },
                offset: "0",
                repeat: "14px",
              },
            ],
          }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, baseRoute?.encodedPolyline, pickupPoint?.lat, pickupPoint?.lng, dropPoint?.lat, dropPoint?.lng]);

  // Active rider -> next stop route on top of the base route.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
    if (!riderPos || !target) return;

    const decoded = roadRoute?.encodedPolyline
      ? decodeGooglePolyline(roadRoute.encodedPolyline)
      : [];
    const usingRoad = decoded.length >= 2;
    const path = usingRoad ? decoded : [riderPos, target];
    routeLineRef.current = new window.google.maps.Polyline({
      path,
      map,
      strokeColor: "#00B97A",
      strokeOpacity: usingRoad ? 0.86 : 0,
      strokeWeight: 5,
      zIndex: 5,
      ...(usingRoad
        ? {}
        : {
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 0.9,
                  strokeColor: "#00B97A",
                  scale: 3.5,
                },
                offset: "0",
                repeat: "12px",
              },
            ],
          }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roadRoute?.encodedPolyline, riderPos?.lat, riderPos?.lng, target?.lat, target?.lng]);

  const carrying = status === "PICKED_UP" || status === "IN_TRANSIT";

  let note: string;
  if (!live) {
    note = "Live tracking starts once a rider accepts your parcel.";
  } else if (riderPos && !riderStale && rider?.location_updated_at) {
    note = `Rider location updated ${agoLabel(rider.location_updated_at)}.`;
  } else if (rider?.location_updated_at) {
    note = carrying
      ? `Rider is on the way with your parcel. Updating live as the rider moves (last seen ${agoLabel(rider.location_updated_at)}).`
      : `Rider is arriving at the pickup location (last seen ${agoLabel(rider.location_updated_at)}).`;
  } else if (rider?.available) {
    note = carrying
      ? "Rider is on the way with your parcel. Live location will appear shortly."
      : "Rider assigned — heading to the pickup location.";
  } else {
    note = "Finding a rider for your parcel…";
  }

  const liveFresh = !!riderPos && !riderStale;
  const showMap = hasAny && !failed;

  return (
    <section className="overflow-hidden rounded-[20px] border border-border bg-card shadow-sm">
      <div className="relative h-60 w-full bg-muted">
        {showMap ? (
          <>
            <div ref={mapDivRef} className="h-full w-full" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <MapPin className="h-10 w-10 text-primary/60" />
              </div>
            )}
            {live && (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/95 px-3 py-1.5 text-[11px] font-semibold shadow">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    liveFresh ? "animate-pulse bg-primary" : "bg-muted-foreground"
                  }`}
                />
                {liveFresh
                  ? "Live"
                  : riderPos
                    ? carrying
                      ? "On the way"
                      : "Heading to pickup"
                    : rider?.available
                      ? "Rider assigned"
                      : "Finding a rider"}
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
