import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Order } from "@/lib/ledger-types";

// A detail link that points to the right route depending on the order's side —
// supplier orders live at /orders/$id, customer orders at /customer-orders/$id.
export function OrderLink({
  order,
  className,
  onClick,
  children,
}: {
  order: Pick<Order, "id" | "side">;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return order.side === "receivable" ? (
    <Link
      to="/customer-orders/$id"
      params={{ id: order.id }}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  ) : (
    <Link to="/orders/$id" params={{ id: order.id }} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
