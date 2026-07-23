import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Mirrors Thalae's own live-refresh: subscribe to postgres_changes on both tables
// and invalidate the cached queries so Ledger and Thalae stay in sync if used
// side by side.
export function useOrdersRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("ledger-orders-suppliers")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "suppliers" }, () => {
        queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
