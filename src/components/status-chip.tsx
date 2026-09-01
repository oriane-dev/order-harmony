import { cn } from "@/lib/utils";

const map: Record<string, { label: string; cls: string; dot: string }> = {
  // order-level statuses (the docFlow ladder: packing lists → factures → paiements)
  confirmed: {
    label: "Commande confirmée",
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  deposit_to_pay: {
    label: "Deposit à régler",
    cls: "bg-info/10 text-info",
    dot: "bg-info",
  },
  deposit_paid: {
    label: "Deposit payé",
    cls: "bg-info/15 text-info",
    dot: "bg-info",
  },
  expedition_to_pay: {
    label: "Expédition à payer",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  partially_billed: {
    label: "Partiellement facturé",
    cls: "bg-info/10 text-info",
    dot: "bg-info",
  },
  facture_paid: {
    label: "Facture payée",
    cls: "bg-success/15 text-success",
    dot: "bg-success",
  },
  invoice_to_pay: {
    label: "Facture à payer",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  // axe expédition (fournisseurs)
  not_shipped: {
    label: "Pas expédié",
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  partially_shipped: {
    label: "Expédié partiellement",
    cls: "bg-info/10 text-info",
    dot: "bg-info",
  },
  fully_shipped: {
    label: "Expédié totalement",
    cls: "bg-success/15 text-success",
    dot: "bg-success",
  },
  partially_invoiced: {
    label: "Facturé partiellement",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  closed: { label: "Clôturé", cls: "bg-success/15 text-success", dot: "bg-success" },
  error: {
    label: "Erreur",
    cls: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  // document-level statuses (used on individual docs in the reconciliation flow)
  issued: { label: "Émis", cls: "bg-info/10 text-info", dot: "bg-info" },
  partially_paid: {
    label: "Partiellement payé",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  paid: { label: "Payé", cls: "bg-success/15 text-success", dot: "bg-success" },
  sent: { label: "Envoyé", cls: "bg-info/10 text-info", dot: "bg-info" },
  received: { label: "Reçu", cls: "bg-success/15 text-success", dot: "bg-success" },
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const s = map[status] ?? {
    label: status,
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        s.cls,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
