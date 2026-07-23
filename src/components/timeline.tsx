import type { TimelineEvent } from "@/lib/ledger-types";
import { shortDate } from "@/lib/format";
import { shortMoney } from "@/lib/format";
import {
  FileText,
  Truck,
  Receipt,
  Banknote,
  ArrowLeftRight,
  StickyNote,
  ShieldAlert,
  FileSignature,
} from "lucide-react";

const iconFor = (k: string) => {
  switch (k) {
    case "po":
    case "so":
      return FileText;
    case "delivery":
      return Truck;
    case "supplier_invoice":
    case "customer_invoice":
      return Receipt;
    case "proforma":
      return FileSignature;
    case "payment":
      return Banknote;
    case "transfer":
      return ArrowLeftRight;
    case "status":
      return ShieldAlert;
    default:
      return StickyNote;
  }
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative">
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" aria-hidden />
      {events.map((e, i) => {
        const Icon = iconFor(e.kind);
        return (
          <li
            key={e.id}
            className="relative pl-10 pb-6 last:pb-0 reveal"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="absolute left-0 top-0.5 flex size-8 items-center justify-center rounded-full border border-border bg-card shadow-sm">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{e.title}</div>
                <div className="text-xs text-muted-foreground">{shortDate(e.at)}</div>
              </div>
              {typeof e.amount === "number" && (
                <div className="font-serif text-base num">{shortMoney(e.amount, e.currency)}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
