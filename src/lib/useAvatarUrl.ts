import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signAddressPhotoUrl } from "./storageUrl";

async function fetchAvatarUrl(): Promise<string | null> {
  // getSession() reads the locally stored session — no network round trip,
  // unlike getUser(), which used to add a full request before the photo query.
  const { data: sessionRes } = await supabase.auth.getSession();
  const uid = sessionRes.session?.user?.id;

  if (!uid) return null;
  const { data } = await supabase
    .from("users")
    .select("avatar_url")
    .eq("id", uid)
    .single();
  if (!data?.avatar_url) return null;
  return await signAddressPhotoUrl(data.avatar_url);
}

export function useAvatarUrl() {
  return useQuery({
    queryKey: ["user-avatar-url"],
    queryFn: fetchAvatarUrl,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
