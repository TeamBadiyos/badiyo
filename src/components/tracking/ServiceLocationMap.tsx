import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { SelectedAddress } from "../BookingSummaryScreen";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import { supabase } from "@/integrations/supabase/client";

type ExpertLocation = {
  expert_id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
  is_online: boolean | null;
};

/** Location older than this is considered stale — we stop showing the marker. */
const STALE_MS = 5 * 60 * 1000;

async function fetchExpertLocation(bookingId: string): Promise<ExpertLocation | null> {
  const { data, error } = await supabase.rpc("get_assigned_expert_location", {
    _booking_id: bookingId,
  });
  if (error) {
    console.error("get_assigned_expert_location failed:", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ExpertLocation | undefined) ?? null;
}

function agoLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

/**
 * Map card used on customer-facing tracking screens. Shows the service address
 * pin and, when a booking id is supplied and the assigned expert has recent
 * coordinates, a live-updating expert marker.
 */
export function ServiceLocationMap({
  address,
  bookingId,
}: {
  address: SelectedAddress;
  bookingId?: string | null;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  // The Maps JS API is loaded dynamically and typed loosely by the loader.
  const mapRef = useRef<any>(null);
  const expertMarkerRef = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  const hasCoords = !!(address.latitude && address.longitude);

  const { data: expert } = useQuery({
    queryKey: ["expert-location", bookingId],
    queryFn: () => fetchExpertLocation(bookingId as string),
    enabled: !!bookingId,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const updatedAt = expert?.location_updated_at
    ? new Date(expert.location_updated_at).getTime()
    : null;
  const isStale = updatedAt == null || Date.now() - updatedAt > STALE_MS;
  const liveExpert =
    expert && expert.latitude != null && expert.longitude != null && !isStale
      ? { lat: Number(expert.latitude), lng: Number(expert.longitude) }
      : null;

  useEffect(() => {
    if (!hasCoords) return;
    let cancelled = false;
    loadMapsScript()
      .then(() => {
        if (cancelled || !mapDivRef.current || !window.google?.maps) return;
        const center = { lat: address.latitude!, lng: address.longitude! };
        const map = new window.google.maps.Map(mapDivRef.current, {
          center,
          zoom: 16,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          clickableIcons: false,
          draggable: false,
          zoomControl: false,
        });
        new window.google.maps.Marker({ position: center, map });
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      mapRef.current = null;
      expertMarkerRef.current = null;
    };
  }, [hasCoords, address.latitude, address.longitude]);

  // Create / move / remove the expert marker as fresh coordinates arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;

    if (!liveExpert) {
      expertMarkerRef.current?.setMap(null);
      expertMarkerRef.current = null;
      return;
    }

    if (!expertMarkerRef.current) {
      expertMarkerRef.current = new window.google.maps.Marker({
        position: liveExpert,
        map,
        title: expert?.name ?? "Expert",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#00B97A",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    } else {
      expertMarkerRef.current.setPosition(liveExpert);
    }

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend({ lat: address.latitude!, lng: address.longitude! });
    bounds.extend(liveExpert);
    map.fitBounds(bounds, 60);
  }, [ready, liveExpert?.lat, liveExpert?.lng, expert?.name, address.latitude, address.longitude]);

  const showMap = hasCoords && !failed;

  let trackingNote: string;
  if (!bookingId) {
    trackingNote = "Live expert tracking starts once an expert is assigned.";
  } else if (liveExpert && expert?.location_updated_at) {
    trackingNote = `Expert location updated ${agoLabel(expert.location_updated_at)}.`;
  } else if (expert && expert.location_updated_at) {
    trackingNote = `Expert location paused — last seen ${agoLabel(expert.location_updated_at)}.`;
  } else if (expert) {
    trackingNote = "Waiting for the expert's location…";
  } else {
    trackingNote = "Live expert tracking starts once an expert is assigned.";
  }

  return (
    <section className="mt-5 overflow-hidden rounded-[18px] border border-border bg-card">
      <div className="relative h-48 w-full bg-muted">
        {showMap ? (
          <>
            <div ref={mapDivRef} className="h-full w-full" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <MapPin className="h-10 w-10 text-primary/60" />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 text-center">
            <MapPin className="h-10 w-10 text-primary" />
            <div className="mt-2 text-xs font-medium text-muted-foreground">
              {hasCoords ? "Map preview unavailable" : "Location unavailable"}
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-sm font-bold text-foreground">Service location</div>
        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
          {address.full_address}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {liveExpert && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          )}
          {trackingNote}
        </div>
      </div>
    </section>
  );
}
