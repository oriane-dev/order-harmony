import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Live cross-device refresh: subscribe to postgres_changes on the four blob tables
// (suppliers + customers, orders + fiches) and invalidate the matching cached queries
// so a change made on ONE computer refreshes on every other open session — without a
// manual reload. Requires the tables to be in the `supabase_realtime` publication
// (see supabase-setup.sql). Even if realtime is off, a page reload still fetches the
// latest data from Supabase, so nothing is ever lost — this only removes the need to
// reload.
export function useOrdersRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const tables = ["orders", "suppliers", "customer_orders", "customers"] as const;
    let channel = supabase.channel("ledger-live");
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        queryClient.invalidateQueries({ queryKey: [table] });
      });
    }
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
