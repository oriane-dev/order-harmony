// Two parallel domains — supplier (achats) and customer (ventes) — stored in mirrored
// Supabase tables (orders/suppliers vs customer_orders/customers). Shared components
// take an `Entity` and read the right tables, cache keys, routes and labels from here.

export type Entity = "supplier" | "customer";

export interface EntityConfig {
  entity: Entity;
  side: "payable" | "receivable";
  ordersTable: "orders" | "customer_orders";
  partyTable: "suppliers" | "customers";
  /** react-query keys */
  rawOrdersKey: string[];
  ordersKey: string[];
  partyKey: string[];
  /** labels (French) */
  party: string; // "Fournisseur"
  partyPlural: string; // "Fournisseurs"
  ordersTitle: string; // "Commandes fournisseurs"
  ordersEyebrow: string; // "Commandes fournisseurs"
  newOrder: string; // "Nouvelle commande"
  newParty: string; // "Nouveau fournisseur"
}

export const ENTITIES: Record<Entity, EntityConfig> = {
  supplier: {
    entity: "supplier",
    side: "payable",
    ordersTable: "orders",
    partyTable: "suppliers",
    rawOrdersKey: ["orders", "raw"],
    ordersKey: ["orders"],
    partyKey: ["suppliers"],
    party: "Fournisseur",
    partyPlural: "Fournisseurs",
    ordersTitle: "Toutes les commandes fournisseurs",
    ordersEyebrow: "Commandes fournisseurs",
    newOrder: "Nouvelle commande",
    newParty: "Nouveau fournisseur",
  },
  customer: {
    entity: "customer",
    side: "receivable",
    ordersTable: "customer_orders",
    partyTable: "customers",
    rawOrdersKey: ["customer_orders", "raw"],
    ordersKey: ["customer_orders"],
    partyKey: ["customers"],
    party: "Client",
    partyPlural: "Clients",
    ordersTitle: "Toutes les commandes clients",
    ordersEyebrow: "Commandes clients",
    newOrder: "Nouvelle commande",
    newParty: "Nouveau client",
  },
};
