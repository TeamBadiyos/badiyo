import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Home, MapPin, Plus, Trash2 } from "lucide-react";
import { SwipeableRow } from "./SwipeableRow";
import { hapticSelection, hapticImpact, hapticNotification } from "@/lib/haptics";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signAddressPhotoUrl } from "@/lib/storageUrl";
import { AddAddressMapScreen, type PickedAddress } from "./AddAddressMapScreen";
import { useT } from "@/i18n";

type Address = {
  id: string;
  label: string | null;
  full_address: string;
  area: string | null;
  city: string | null;
  is_default: boolean | null;
  landmark_photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

async function fetchAddresses(): Promise<Address[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, area, city, is_default, landmark_photo_url, latitude, longitude")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Address[];
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      landmark_photo_url: await signAddressPhotoUrl(r.landmark_photo_url),
    })),
  );
}

export function AddressSelectionScreen({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (address: Address) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ["addresses"],
    queryFn: fetchAddresses,
  });

  async function deleteAddress(id: string) {
    void hapticImpact("medium");
    const { error } = await supabase.from("addresses").delete().eq("id", id);
    if (error) {
      void hapticNotification("error");
      toast.error("Couldn't delete this address.");
      return;
    }
    setSelectedId((cur) => (cur === id ? null : cur));
    void hapticNotification("success");
    toast.success("Address deleted");
    qc.invalidateQueries({ queryKey: ["addresses"] });
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && addresses.length > 0) {
      const def = addresses.find((a) => a.is_default) ?? addresses[0];
      setSelectedId(def.id);
    }
  }, [addresses, selectedId]);

  const addMutation = useMutation({
    mutationFn: async (input: PickedAddress) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        throw new Error("You need to sign in before saving an address.");
      }
      // Ensure a matching row exists in public.users to satisfy the FK.
      const { error: userUpsertError } = await supabase
        .from("users")
        .upsert({ id: uid }, { onConflict: "id" });
      if (userUpsertError) throw userUpsertError;

      const { data, error } = await supabase
        .from("addresses")
        .insert({
          user_id: uid,
          label: input.label,
          full_address: input.full_address,
          area: input.area,
          city: input.city ?? undefined,
          latitude: input.latitude,
          longitude: input.longitude,
          is_default: addresses.length === 0,
        })
        .select("id, label, full_address, area, city, is_default, landmark_photo_url, latitude, longitude")
        .single();
      if (error) throw error;
      const created = data as Address;

      if (input.photo) {
        const ext = (input.photo.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${uid}/${created.id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("address-photos")
          .upload(path, input.photo, {
            upsert: true,
            contentType: input.photo.type || "image/jpeg",
          });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage
          .from("address-photos")
          .getPublicUrl(path);
        const publicUrl = pub.publicUrl;
        const { error: updErr } = await supabase
          .from("addresses")
          .update({ landmark_photo_url: publicUrl })
          .eq("id", created.id);
        if (updErr) throw updErr;
        created.landmark_photo_url = await signAddressPhotoUrl(publicUrl);
      }

      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["addresses"] });
      setSelectedId(created.id);
      setSheetOpen(false);
    },
  });

  const selected = addresses.find((a) => a.id === selectedId) ?? null;

  return (
    <main className="min-h-screen w-full bg-background pb-28">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-base font-bold text-foreground">
            {t("address.title")}
          </h1>
        </div>

        {/* Content */}
        <div className="mt-6">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {t("address.loading")}
            </div>
          ) : addresses.length === 0 ? (
            <div className="mt-8 flex flex-col items-center rounded-[18px] border border-border bg-card px-6 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <MapPin className="h-7 w-7 text-primary" />
              </div>
              <p className="mt-4 text-base font-bold text-foreground">
                {t("address.emptyTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("address.emptySub")}
              </p>
              <button
                onClick={() => setSheetOpen(true)}
                className="mt-6 w-full rounded-[14px] bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition active:scale-[0.99]"
              >
                {t("address.addNewPlus")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {addresses.map((a) => {
                const active = a.id === selectedId;
                return (
                  <SwipeableRow
                    key={a.id}
                    className="rounded-[18px]"
                    actions={[
                      {
                        label: "Delete",
                        icon: <Trash2 className="h-4 w-4" />,
                        className: "bg-destructive text-white",
                        onAction: () => deleteAddress(a.id),
                      },
                    ]}
                  >
                    <button
                      onClick={() => {
                        void hapticSelection();
                        setSelectedId(a.id);
                      }}
                      className={`flex w-full items-start gap-3 rounded-[18px] border p-4 text-left transition ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card"
                      }`}
                    >
                      {a.landmark_photo_url ? (
                        <img
                          src={a.landmark_photo_url}
                          alt={a.label || "Home"}
                          className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-primary/10">
                          <Home className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-foreground">
                          {a.label || t("address.fallbackLabel")}
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground line-clamp-2 selectable">
                          {a.full_address}
                        </div>
                        {a.area && (
                          <div className="mt-0.5 text-xs text-muted-foreground/80">
                            {a.area}
                          </div>
                        )}
                      </div>
                      <span
                        aria-hidden
                        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                          active ? "border-primary" : "border-border"
                        }`}
                      >
                        {active && (
                          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                        )}
                      </span>
                    </button>
                  </SwipeableRow>
                );
              })}

              <button
                onClick={() => setSheetOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-border bg-transparent px-4 py-4 text-sm font-bold text-primary transition active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" />
                {t("address.addNew")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed continue */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card">
        <div className="mx-auto w-full max-w-md px-5 py-4">
          <button
            disabled={!selected}
            onClick={() => selected && onContinue(selected)}
            className={`w-full rounded-[14px] px-4 py-3.5 text-sm font-bold transition ${
              selected
                ? "bg-primary text-primary-foreground active:scale-[0.99]"
                : "bg-primary/30 text-primary-foreground/70"
            }`}
          >
            {t("common.continue")}
          </button>
        </div>
      </div>

      {/* Full-screen map picker */}
      {sheetOpen && (
        <AddAddressMapScreen
          onBack={() => setSheetOpen(false)}
          onSave={(input) => addMutation.mutate(input)}
          isSaving={addMutation.isPending}
          error={addMutation.error?.message ?? null}
        />
      )}
    </main>
  );
}
