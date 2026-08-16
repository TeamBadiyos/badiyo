import logoWhiteAsset from "@/assets/badiyos-logo-white.png.asset.json";
import logoGreenAsset from "@/assets/badiyos-logo-green.png.asset.json";
import { isNativeShell } from "@/lib/nativeServerFn";

// Brand-critical wordmarks are also bundled into public/brand so the native
// Capacitor build (which has no server at its origin and may be offline) can
// always render them. The CDN pointer stays the source of truth on the web.
const LOCAL = {
  white: "/brand/badiyos-wordmark-white.webp",
  green: "/brand/badiyos-wordmark-green.webp",
} as const;

export function BadiyoLogo({
  className = "",
  variant = "white",
}: {
  className?: string;
  variant?: "white" | "green";
}) {
  const cdn = variant === "green" ? logoGreenAsset.url : logoWhiteAsset.url;
  const local = LOCAL[variant];
  const src = isNativeShell() ? local : cdn;
  return (
    <img
      src={src}
      alt="badiyos"
      className={className}
      draggable={false}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith(local)) img.src = local;
      }}
    />
  );
}
