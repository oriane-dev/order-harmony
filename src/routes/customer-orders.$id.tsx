import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { OrderDetailContent } from "@/components/order-detail-page";
import type { Order } from "@/lib/ledger-types";
import { findOrder } from "@/lib/ledger-types";
import { customerOrdersQueryOptions } from "@/lib/data";

export const Route = createFileRoute("/customer-orders/$id")({
  loader: async ({ params, context }): Promise<{ order: Order }> => {
    const orders = await context.queryClient.ensureQueryData(customerOrdersQueryOptions());
    const order = findOrder(orders, params.id);
    if (!order) throw notFound();
    return { order };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.order.number} · Ledger` : "Commande client · Ledger" },
      {
        name: "description",
        content: loaderData
          ? `${loaderData.order.party.name} — ${loaderData.order.number}`
          : "Détail de la commande client",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CustomerOrderPage,
  notFoundComponent: () => (
    <AppShell>
      <div className="max-w-xl mx-auto text-center py-24">
        <h1 className="font-serif text-3xl">Commande introuvable</h1>
        <p className="text-muted-foreground mt-2">La commande que tu cherches n'existe pas.</p>
        <Link to="/customer-orders" className="inline-block mt-6 text-accent hover:underline">
          Retour aux commandes clients
        </Link>
      </div>
    </AppShell>
  ),
});

function CustomerOrderPage() {
  const { order } = Route.useLoaderData();
  return <OrderDetailContent order={order} entity="customer" />;
}
