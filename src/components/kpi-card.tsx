import { cn } from "@/lib/utils";
import { shortMoney } from "@/lib/format";

interface Props {
  label: string;
  value: number;
  currency?: string;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger";
  className?: string;
}

const toneMap = {
  default: "text-foreground",
  positive: "text-success",
  warning: "text-warning-foreground",
  danger: "text-destructive",
};

export function KpiCard({
  label,
  value,
  currency = "EUR",
  hint,
  tone = "default",
  className,
}: Props) {
  return (
    <div className={cn("card-elev p-5 flex flex-col gap-2 reveal", className)}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-serif text-4xl leading-none num", toneMap[tone])}>
        {shortMoney(value, currency)}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
