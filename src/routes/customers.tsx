import { createFileRoute } from "@tanstack/react-router";
import { PartyListPage } from "@/components/party-list-page";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Clients · Ledger" }] }),
  component: () => <PartyListPage entity="customer" />,
});
