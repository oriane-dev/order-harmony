import { useMemo, useState } from "react";
import type { DocRef } from "@/lib/ledger-types";
import { shortMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  docs: DocRef[];
}

// Columns in the flow, in order left-to-right.
const columns: { kinds: string[]; title: string }[] = [
  { kinds: ["po", "so"], title: "Commande" },
  { kinds: ["proforma"], title: "Pro forma" },
  { kinds: ["delivery"], title: "Livraisons" },
  { kinds: ["supplier_invoice", "customer_invoice", "credit_note"], title: "Factures" },
  { kinds: ["transfer", "payment"], title: "Paiements" },
];

const NODE_W = 168;
const NODE_H = 68;
const COL_GAP = 56;
const ROW_GAP = 14;
const PAD_X = 16;
const PAD_Y = 16;

export function ReconciliationFlow({ docs }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; col: number; row: number }>();
    const colDocs = columns.map((c) => docs.filter((d) => c.kinds.includes(d.kind)));
    const cols = colDocs.filter((c) => c.length > 0);
    const usedCols = columns
      .map((c, i) => ({ c, i, docs: colDocs[i] }))
      .filter((x) => x.docs.length > 0);

    let x = PAD_X;
    const colX: number[] = [];
    usedCols.forEach(() => {
      colX.push(x);
      x += NODE_W + COL_GAP;
    });
    const width = x - COL_GAP + PAD_X;
    const maxRows = Math.max(...usedCols.map((u) => u.docs.length));
    const height = PAD_Y * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP + 24;

    usedCols.forEach((u, ci) => {
      u.docs.forEach((d, ri) => {
        positions.set(d.id, {
          x: colX[ci],
          y: PAD_Y + 24 + ri * (NODE_H + ROW_GAP),
          col: ci,
          row: ri,
        });
      });
    });

    // build edges: from each doc to each linked doc if the linked doc is in a later column
    const edges: { from: string; to: string }[] = [];
    docs.forEach((d) => {
      d.linkedTo.forEach((tid) => {
        const a = positions.get(d.id);
        const b = positions.get(tid);
        if (!a || !b) return;
        if (b.col > a.col) edges.push({ from: d.id, to: tid });
      });
    });

    return { positions, width, height, usedCols, colX, edges };
  }, [docs]);

  const activeSet = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    // walk edges forward and backward
    let changed = true;
    while (changed) {
      changed = false;
      layout.edges.forEach((e) => {
        if (s.has(e.from) && !s.has(e.to)) {
          s.add(e.to);
          changed = true;
        }
        if (s.has(e.to) && !s.has(e.from)) {
          s.add(e.from);
          changed = true;
        }
      });
    }
    return s;
  }, [hovered, layout.edges]);

  const isDimmed = (id: string) => activeSet !== null && !activeSet.has(id);
  const edgeActive = (from: string, to: string) =>
    activeSet !== null && activeSet.has(from) && activeSet.has(to);

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        {/* Column headers */}
        {layout.usedCols.map((u, i) => (
          <div
            key={u.i}
            className="absolute text-[10px] uppercase tracking-wider text-muted-foreground"
            style={{ left: layout.colX[i], top: 0, width: NODE_W }}
          >
            {u.c.title}
          </div>
        ))}

        {/* Edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={layout.width}
          height={layout.height}
        >
          {layout.edges.map((e, i) => {
            const a = layout.positions.get(e.from)!;
            const b = layout.positions.get(e.to)!;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const cx = (x1 + x2) / 2;
            const active = edgeActive(e.from, e.to);
            const dim = activeSet !== null && !active;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`}
                fill="none"
                stroke={active ? "var(--color-accent)" : "var(--color-border)"}
                strokeWidth={active ? 2 : 1.25}
                opacity={dim ? 0.3 : 1}
                className="transition-all duration-200"
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {docs.map((d) => {
          const p = layout.positions.get(d.id);
          if (!p) return null;
          const dim = isDimmed(d.id);
          const highlighted = activeSet !== null && activeSet.has(d.id);
          return (
            <div
              key={d.id}
              onMouseEnter={() => setHovered(d.id)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "absolute card-elev p-3 cursor-pointer transition-all duration-200 select-none",
                dim && "opacity-30",
                highlighted && "ring-2 ring-accent shadow-md -translate-y-0.5",
              )}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-medium truncate">{d.number}</div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {kindLabel(d.kind)}
                </div>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <div className="font-serif text-lg num leading-none">
                  {shortMoney(d.amount, d.currency)}
                </div>
                {typeof d.remaining === "number" && d.remaining !== 0 && (
                  <div
                    className={cn(
                      "text-[10px] num",
                      d.remaining < 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {d.remaining < 0 ? "trop-perçu " : "reste "}
                    {shortMoney(Math.abs(d.remaining), d.currency)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kindLabel(k: string) {
  switch (k) {
    case "po":
      return "BC";
    case "so":
      return "BV";
    case "delivery":
      return "BL";
    case "supplier_invoice":
    case "customer_invoice":
      return "FAC";
    case "proforma":
      return "PF";
    case "credit_note":
      return "NC";
    case "transfer":
      return "VIR";
    case "payment":
      return "PAI";
    default:
      return k;
  }
}
