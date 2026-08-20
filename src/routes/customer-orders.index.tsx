import { createFileRoute } from "@tanstack/react-router";
import { OrdersListPage } from "@/components/orders-list-page";

export const Route = createFileRoute("/customer-orders/")({
  head: () => ({
    meta: [
      { title: "Commandes clients · Cash Flow Management" },
      {
        name: "description",
        content:
          "Toutes les commandes clients, avec l'avancement, le montant facturé, encaissé et le reste à encaisser.",
      },
    ],
  }),
  component: () => <OrdersListPage entity="customer" />,
});
