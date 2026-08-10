// Excel export and JSON backup export/import — ported from Thalae's OrdersPage
// (exportExcel/exportBackup/importBackup), same column set, same backup shape,
// same upsertByRef-by-reference matching logic on restore.

import * as XLSX from "xlsx";
import { saveOrder } from "@/lib/thalae-mutations";
import type { OrdersTable } from "@/lib/thalae-mutations";
import type { RawOrder, RawSupplier } from "@/lib/thalae-types";
import { fmtDate } from "@/lib/format";

function tod(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportOrdersExcel(orders: RawOrder[]): void {
  if (!orders.length) {
    alert("Aucune commande à exporter.");
    return;
  }
  const rows = orders.map((o) => ({
    Référence: o.reference || "",
    Fournisseur: o.fournisseur || "",
    Produit: o.produit || "",
    "Date commande": o.dateCommande ? fmtDate(o.dateCommande) : "",
    "Date livraison": o.dateLivraison ? fmtDate(o.dateLivraison) : "",
    "Montant (€)": o.montant || 0,
    "Docket Qty": o.quantite || 0,
    "N+O+P": o.nop || 0,
    Écart: o.nop && o.quantite ? o.nop - o.quantite : 0,
    "Production (pcs)": o.progressProduction || 0,
    "Livraison (pcs)": o.progressLivraison || 0,
    Collection: o.notes || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Production Orders");
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 8 })];
    if (cell && cell.v !== 0) {
      cell.s = { fill: { fgColor: { rgb: "FDE68A" } }, font: { bold: true } };
    }
  }
  XLSX.writeFile(wb, "production-orders.xlsx");
}

export function exportBackup(orders: RawOrder[], suppliers: RawSupplier[]): void {
  const payload = { version: 3, exportedAt: new Date().toISOString(), orders, suppliers };
  downloadBlob(
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    `sauvegarde-commandes-${tod()}.json`,
  );
}

// Matches Thalae's upsertByRef: match by reference string equality against the
// CURRENT order set. On a match, only scalar business fields are overwritten —
// docFlow/attachments/documents on the existing order are left untouched, so a
// restore never clobbers real financial data already recorded against an order.
async function upsertByRef(
  currentOrders: RawOrder[],
  incoming: RawOrder,
  table: OrdersTable,
): Promise<void> {
  const existing = incoming.reference
    ? currentOrders.find((o) => o.reference === incoming.reference)
    : undefined;
  if (existing) {
    await saveOrder(
      {
        ...existing,
        fournisseur: incoming.fournisseur,
        produit: incoming.produit,
        montant: incoming.montant,
        devise: incoming.devise,
        dateCommande: incoming.dateCommande,
        dateLivraison: incoming.dateLivraison,
        incoterms: incoming.incoterms,
        notes: incoming.notes,
        quantite: incoming.quantite,
        nop: incoming.nop,
        progressProduction: incoming.progressProduction,
        progressLivraison: incoming.progressLivraison,
      },
      table,
    );
  } else {
    await saveOrder(incoming, table);
  }
}

export async function importBackup(
  file: File,
  currentOrders: RawOrder[],
  table: OrdersTable = "orders",
): Promise<number> {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload.orders)
    throw new Error("Fichier de sauvegarde invalide — aucun tableau de commandes.");
  for (const o of payload.orders as RawOrder[]) {
    await upsertByRef(currentOrders, o, table);
  }
  return payload.orders.length;
}
