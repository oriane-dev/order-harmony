import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PaymentsCalendar } from "@/components/payments-calendar";
import { cn } from "@/lib/utils";
import type { Entity } from "@/lib/entities";

export const Route = createFileRoute("/calendrier")({
  head: () => ({
    meta: [
      { title: "Calendrier des paiements · Cash Flow Management" },
      {
        name: "description",
        content:
          "Vue calendrier des montants payés et encaissés par mois et par saison — réel jusqu'au mois en cours, attendu ensuite d'après les livraisons et les échéances.",
      },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const [entity, setEntity] = useState<Entity>("supplier");
  const tabs: { value: Entity; label: string }[] = [
    { value: "supplier", label: "Fournisseurs" },
    { value: "customer", label: "Clients" },
  ];

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Calendrier
            </div>
            <h1 className="font-serif text-4xl mt-1">Paiements par mois et par saison</h1>
          </div>
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-card">
            {tabs.map((t) => (
              <button
                key={t.value}
                onClick={() => setEntity(t.value)}
                className={cn(
                  "px-4 py-1.5 text-sm rounded-md transition-colors",
                  entity === t.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <PaymentsCalendar entity={entity} />
      </div>
    </AppShell>
  );
}
