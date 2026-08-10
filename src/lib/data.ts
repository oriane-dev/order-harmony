import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildSupplierIndex, rawOrderToLedgerOrder } from "@/lib/thalae-adapter";
import type { Order } from "@/lib/ledger-types";
import type { RawOrder, RawSupplier } from "@/lib/thalae-types";

// Reads a jsonb-blob table. `optional` tables (the customer ones) may not exist yet —
// the user creates them in Supabase before importing — so a missing-relation error is
// swallowed and treated as "empty" so the whole app keeps working until then.
async function fetchBlobTable<T>(table: string, optional = false): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("data");
  if (error) {
    if (optional) {
      console.warn(`[data] table "${table}" unavailable (${error.message}) — treating as empty.`);
      return [];
    }
    throw error;
  }
  return (data ?? []).map((r) => r.data as T);
}

/* ── SUPPLIERS (achats) ────────────────────────────────────────────────── */

export function rawOrdersQueryOptions() {
  return queryOptions({
    queryKey: ["orders", "raw"],
    queryFn: () => fetchBlobTable<RawOrder>("orders"),
    staleTime: 60_000,
  });
}

export function rawSuppliersQueryOptions() {
  return queryOptions({
    queryKey: ["suppliers"],
    queryFn: () => fetchBlobTable<RawSupplier>("suppliers"),
    staleTime: 60_000,
  });
}

// Adapted Order[] (side = payable) for the read views.
export function ordersQueryOptions() {
  return queryOptions({
    queryKey: ["orders"],
    queryFn: async (): Promise<Order[]> => {
      const rows = await fetchBlobTable<RawOrder>("orders");
      const index = buildSupplierIndex(rows.map((r) => r.fournisseur ?? ""));
      return rows.map((r) => rawOrderToLedgerOrder(r, index, "payable"));
    },
    staleTime: 60_000,
  });
}

/* ── CUSTOMERS (ventes) — tables may not exist yet, so fetches are optional ─ */

export function rawCustomerOrdersQueryOptions() {
  return queryOptions({
    queryKey: ["customer_orders", "raw"],
    queryFn: () => fetchBlobTable<RawOrder>("customer_orders", true),
    staleTime: 60_000,
  });
}

export function rawCustomersQueryOptions() {
  return queryOptions({
    queryKey: ["customers"],
    queryFn: () => fetchBlobTable<RawSupplier>("customers", true),
    staleTime: 60_000,
  });
}

// Adapted Order[] (side = receivable) for the read views.
export function customerOrdersQueryOptions() {
  return queryOptions({
    queryKey: ["customer_orders"],
    queryFn: async (): Promise<Order[]> => {
      const rows = await fetchBlobTable<RawOrder>("customer_orders", true);
      const index = buildSupplierIndex(rows.map((r) => r.fournisseur ?? ""));
      return rows.map((r) => rawOrderToLedgerOrder(r, index, "receivable"));
    },
    staleTime: 60_000,
  });
}
