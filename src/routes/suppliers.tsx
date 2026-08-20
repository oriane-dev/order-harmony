import { createFileRoute } from "@tanstack/react-router";
import { PartyListPage } from "@/components/party-list-page";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Fournisseurs · Cash Flow Management" }] }),
  component: () => <PartyListPage entity="supplier" />,
});
