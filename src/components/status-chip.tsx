import { cn } from "@/lib/utils";

const map: Record<string, { label: string; cls: string; dot: string }> = {
  // order-level statuses (the docFlow ladder: packing lists → factures → paiements)
  confirmed: {
    label: "Commande confirmée",
    cls: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  partially_shipped: {
    label: "Expédiée partiellement",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  partially_invoiced: {
    label: "Facturée partiellement",
    cls: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  to_settle: { label: "À solder", cls: "bg-info/10 text-info", dot: "bg-info" },
  closed: { label: "Clôturée", cls: "bg-success/15 text-success", dot: "bg-success" },
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
