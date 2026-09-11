import { supabase } from "@/integrations/supabase/client";

/**
 * Upload a profile photo for the given user and store its URL on the users row.
 * Returns the public URL that was saved.
 */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${uid}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("address-photos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("address-photos").getPublicUrl(path);
  const url = pub.publicUrl;
  const { error: updErr } = await supabase.from("users").update({ avatar_url: url }).eq("id", uid);
  if (updErr) throw updErr;
  return url;
}
