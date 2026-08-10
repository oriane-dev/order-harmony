import { createFileRoute } from "@tanstack/react-router";
import { OrdersListPage } from "@/components/orders-list-page";

export const Route = createFileRoute("/orders/")({
  head: () => ({
    meta: [
      { title: "Commandes fournisseurs · Ledger" },
      {
        name: "description",
        content:
          "Toutes les commandes fournisseurs, avec l'avancement de production, le montant payé et le reste à payer.",
      },
    ],
  }),
  component: () => <OrdersListPage entity="supplier" />,
});
