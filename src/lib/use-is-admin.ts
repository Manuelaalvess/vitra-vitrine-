import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AdminState = {
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
};

export function useIsAdmin(): AdminState {
  const [state, setState] = useState<AdminState>({
    loading: true,
    isAuthenticated: false,
    isAdmin: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function check(userId: string | null) {
      if (!userId) {
        if (!cancelled) setState({ loading: false, isAuthenticated: false, isAdmin: false });
        return;
      }
      const { data } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (!cancelled) {
        setState({ loading: false, isAuthenticated: true, isAdmin: Boolean(data) });
      }
    }

    supabase.auth.getUser().then(({ data }) => check(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        check(session?.user?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
