import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { OrderDetailContent } from "@/components/order-detail-page";
import type { Order } from "@/lib/ledger-types";
import { findOrder } from "@/lib/ledger-types";
import { ordersQueryOptions } from "@/lib/data";

export const Route = createFileRoute("/orders/$id")({
  loader: async ({ params, context }): Promise<{ order: Order }> => {
    const orders = await context.queryClient.ensureQueryData(ordersQueryOptions());
    const order = findOrder(orders, params.id);
    if (!order) throw notFound();
    return { order };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.order.number} · Cash Flow Management` : "Commande · Cash Flow Management" },
      {
        name: "description",
        content: loaderData
          ? `${loaderData.order.party.name} — ${loaderData.order.number}`
          : "Détail de la commande",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SupplierOrderPage,
  notFoundComponent: () => (
    <AppShell>
      <div className="max-w-xl mx-auto text-center py-24">
        <h1 className="font-serif text-3xl">Commande introuvable</h1>
        <p className="text-muted-foreground mt-2">La commande que tu cherches n'existe pas.</p>
        <Link to="/orders" className="inline-block mt-6 text-accent hover:underline">
          Retour aux commandes fournisseurs
        </Link>
      </div>
    </AppShell>
  ),
});

function SupplierOrderPage() {
  const { order } = Route.useLoaderData();
  return <OrderDetailContent order={order} entity="supplier" />;
}
