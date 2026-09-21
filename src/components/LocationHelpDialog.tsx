/**
 * Friendly, bilingual popup shown when the device location can't be read.
 *
 * Two distinct cases:
 *  - "disabled": the phone's location/GPS master switch is off  -> system Location settings
 *  - "denied":   the app doesn't have location permission       -> app permission settings
 */
import { MapPin, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { openAppSettings, openLocationSettings } from "@/lib/nativeGeolocation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type LocationHelpKind = "disabled" | "denied" | null;

export function LocationHelpDialog({
  kind,
  onClose,
}: {
  kind: LocationHelpKind;
  onClose: () => void;
}) {
  const t = useT();
  const disabled = kind === "disabled";

  const handleOpen = async () => {
    const ok = disabled
      ? await openLocationSettings()
      : await openAppSettings();
    if (!ok) toast.info(t("loc.settingsUnavailable"));
    onClose();
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[20rem] rounded-2xl">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {disabled ? (
              <MapPin className="h-7 w-7 text-primary" />
            ) : (
              <Settings2 className="h-7 w-7 text-primary" />
            )}
          </div>
          <DialogTitle className="text-base">
            {disabled ? t("loc.offTitle") : t("loc.deniedTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {disabled ? t("loc.offBody") : t("loc.deniedBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={handleOpen}>
            {disabled ? t("loc.turnOn") : t("loc.openSettings")}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t("loc.searchManually")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
