import { createFileRoute } from "@tanstack/react-router";
import { PartyListPage } from "@/components/party-list-page";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Clients · Cash Flow Management" }] }),
  component: () => <PartyListPage entity="customer" />,
});
