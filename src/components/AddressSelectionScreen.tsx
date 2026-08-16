import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Home, MapPin, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
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
  /** Manage mode (Profile -> My Addresses): list + edit/delete, no Continue bar. */
  manage = false,
}: {
  onBack: () => void;
  onContinue?: (address: Address) => void;
  manage?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ["addresses"],
    queryFn: fetchAddresses,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Address | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteAddress(id: string) {
    void hapticImpact("medium");
    setDeleting(true);
    const { error } = await supabase.rpc("customer_delete_address", {
      p_address_id: id,
    });
    setDeleting(false);
    if (error) {
      console.error("[address] delete failed:", error);
      void hapticNotification("error");
      toast.error("Couldn't delete this address.");
      return;
    }
    setConfirmDelete(null);
    setMenuFor(null);
    if (selectedId === id) {
      setSelectedId(null);
      toast.info("Pick another delivery address or detect your location.");
    }
    void hapticNotification("success");
    toast.success("Address deleted");
    qc.invalidateQueries({ queryKey: ["addresses"] });
  }

  useEffect(() => {
    if (!selectedId && addresses.length > 0) {
      const def = addresses.find((a) => a.is_default) ?? addresses[0];
      setSelectedId(def.id);
    }
  }, [addresses, selectedId]);

  const editMutation = useMutation({
    mutationFn: async (input: PickedAddress & { id: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to sign in before saving an address.");

      let photoUrl: string | null = null;
      if (input.photo) {
        const ext = (input.photo.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${uid}/${input.id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("address-photos")
          .upload(path, input.photo, {
            upsert: true,
            contentType: input.photo.type || "image/jpeg",
          });
        if (upErr) throw upErr;
        photoUrl = supabase.storage.from("address-photos").getPublicUrl(path)
          .data.publicUrl;
      }

      const { error } = await supabase.rpc("customer_update_address", {
        p_address_id: input.id,
        p_label: input.label,
        p_full_address: input.full_address,
        // The RPC accepts NULLs; generated types widen these to string.
        p_area: input.area as unknown as string,
        p_city: input.city as unknown as string,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_landmark_photo_url: photoUrl ?? undefined,
      });

      if (error) throw error;
      return input.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["addresses"] });
      setSelectedId(id);
      setEditing(null);
      toast.success("Address updated");
    },
    onError: (e) => {
      console.error("[address] update failed:", e);
      toast.error("Couldn't update this address.");
    },
  });


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
    <main className={`min-h-screen w-full bg-background ${manage ? "pb-10" : "pb-28"}`}>
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
            {manage ? "My Addresses" : t("address.title")}
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
                        onAction: () => setConfirmDelete(a),
                      },
                    ]}
                  >
                    <div
                      className={`relative rounded-[18px] border transition ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card"
                      }`}
                    >
                      <button
                        onClick={() => {
                          void hapticSelection();
                          setSelectedId(a.id);
                        }}
                        className="flex w-full items-start gap-3 p-4 pr-12 text-left"
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

                      {/* Per-address actions */}
                      <button
                        type="button"
                        aria-label="Address options"
                        onClick={() => {
                          void hapticSelection();
                          setMenuFor((cur) => (cur === a.id ? null : a.id));
                        }}
                        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuFor === a.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setMenuFor(null)}
                          />
                          <div className="absolute right-2 top-11 z-20 w-36 overflow-hidden rounded-[14px] border border-border bg-card shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                setEditing(a);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-foreground active:bg-muted"
                            >
                              <Pencil className="h-4 w-4" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                setConfirmDelete(a);
                              }}
                              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-semibold text-destructive active:bg-muted"
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
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

      {/* Fixed continue (booking flow only) */}
      {!manage && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card safe-bottom">
          <div className="mx-auto w-full max-w-md px-5 py-4">
            <button
              disabled={!selected}
              onClick={() => selected && onContinue?.(selected)}
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
      )}

      {/* Full-screen map picker */}
      {sheetOpen && (
        <AddAddressMapScreen
          onBack={() => setSheetOpen(false)}
          onSave={(input) => addMutation.mutate(input)}
          isSaving={addMutation.isPending}
          error={addMutation.error?.message ?? null}
        />
      )}

      {/* Edit an existing address (same map + label + details flow) */}
      {editing && (
        <AddAddressMapScreen
          initial={{
            id: editing.id,
            label: editing.label,
            full_address: editing.full_address,
            latitude: editing.latitude,
            longitude: editing.longitude,
          }}
          onBack={() => setEditing(null)}
          onSave={(input) =>
            editMutation.mutate({ ...input, id: editing.id })
          }
          isSaving={editMutation.isPending}
          error={editMutation.error?.message ?? null}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-[18px] border border-border bg-card p-5">
            <h2 className="text-base font-bold text-foreground">
              Delete this address?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
              {confirmDelete.full_address}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-[14px] border border-border px-4 py-3 text-sm font-bold text-foreground"
              >
                {t("common.cancel")}
              </button>
              <button
                disabled={deleting}
                onClick={() => deleteAddress(confirmDelete.id)}
                className="flex-1 rounded-[14px] bg-destructive px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>

  );
}
