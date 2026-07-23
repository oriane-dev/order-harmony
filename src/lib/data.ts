import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildSupplierIndex, rawOrderToLedgerOrder } from "@/lib/thalae-adapter";
import type { Order } from "@/lib/ledger-types";
import type { RawOrder, RawSupplier } from "@/lib/thalae-types";

async function fetchRawOrders(): Promise<RawOrder[]> {
  const { data, error } = await supabase.from("orders").select("data");
  if (error) throw error;
  return (data ?? []).map((r) => r.data as RawOrder);
}

async function fetchRawSuppliers(): Promise<RawSupplier[]> {
  const { data, error } = await supabase.from("suppliers").select("data");
  if (error) throw error;
  return (data ?? []).map((r) => r.data as RawSupplier);
}

// Raw rows, as Thalae itself reads/writes them — used by the create/edit/import UI
// and the docFlow editor, which need the real structure, not the flattened view.
export function rawOrdersQueryOptions() {
  return queryOptions({
    queryKey: ["orders", "raw"],
    queryFn: fetchRawOrders,
    staleTime: 60_000,
  });
}

export function rawSuppliersQueryOptions() {
  return queryOptions({
    queryKey: ["suppliers"],
    queryFn: fetchRawSuppliers,
    staleTime: 60_000,
  });
}

// Adapted to the Order/Party shape the read-only views (dashboard, orders list,
// reconciliation, alerts, échéances, suppliers rollup) already render.
export function ordersQueryOptions() {
  return queryOptions({
    queryKey: ["orders"],
    queryFn: async (): Promise<Order[]> => {
      const rows = await fetchRawOrders();
      const supplierIndex = buildSupplierIndex(rows.map((r) => r.fournisseur ?? ""));
      return rows.map((r) => rawOrderToLedgerOrder(r, supplierIndex));
    },
    staleTime: 60_000,
  });
}
