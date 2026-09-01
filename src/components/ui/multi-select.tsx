import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Filtre à sélection multiple : une liste vide = « tout » (aucun filtre actif).
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  className,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? label)
        : `${label} · ${selected.length}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2 text-sm hover:bg-surface-2 transition-colors",
            selected.length > 0 ? "border-accent/60 text-foreground" : "border-border",
            className,
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1 max-h-72 overflow-y-auto">
        <button
          type="button"
          onClick={() => onChange([])}
          className={cn(
            "w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-surface-2 transition-colors",
            selected.length === 0 && "text-accent font-medium",
          )}
        >
          Tout ({label.toLowerCase()})
        </button>
        <div className="my-1 border-t border-border" />
        {options.map((o) => (
          <label
            key={o.value}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-surface-2 cursor-pointer"
          >
            <Checkbox
              checked={selected.includes(o.value)}
              onCheckedChange={() => toggle(o.value)}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
