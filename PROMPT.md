# Order Harmony — Spec & design origin

Exporté depuis le projet Lovable "Order Harmony" (`order-sight-line`, id `f828f1a2-82a1-4c09-b221-99b25150ae82`) pour être repris et modifié uniquement via Claude Code.

## Prompt de base

Build an Internal Order & Payment Reconciliation Platform for a Fashion Company

I want to build an internal financial reconciliation platform for a fashion/apparel company.

The objective is not to replace the ERP or accounting software. The application should become the single source of truth allowing finance teams to instantly understand the financial status of every supplier order and every customer order.

The current problem is that information is fragmented across multiple systems and documents:

Purchase Orders (POs)
Sales Orders
Delivery Notes / Goods Received Notes
Supplier Invoices
Customer Invoices
Pro Forma Invoices
Advance Payments (Deposits)
Bank Transfers
Payment Remittances
Credit Notes
Partial Deliveries
Partial Payments

Relationships are many-to-many.

Examples:

- One Delivery Note can contain several Purchase Orders.
- One Purchase Order can be delivered through several Delivery Notes.
- One Invoice may cover several Delivery Notes.
- One Delivery Note may be invoiced through several invoices.
- One bank transfer may pay several invoices.
- One invoice may be paid through several transfers.
- Deposits (Pro Forma) may only cover part of an order.
- Credit Notes may reduce the remaining amount.
- Currency differences may exist.
- Overpayments and underpayments must be visible.
- Some documents may be missing temporarily.
- Documents may arrive in any order.

The application must gracefully support all these situations.

### Core philosophy

The application should be extremely clean and minimalist. No ERP-style interface. The goal is that anyone in Finance can open an order and understand its status within 10 seconds. Everything should be visual. The interface should focus on clarity rather than data density.

### Data Model

Create entities for: Suppliers, Customers, Purchase Orders, Sales Orders, Delivery Notes, Supplier Invoices, Customer Invoices, Pro Forma Invoices, Credit Notes, Payments, Bank Transfers, Remittance Advice, Currencies.

Each document should have: ID, Date, Amount, Currency, Status, Linked documents, Attachments (PDF), Comments, Responsible employee. Relationships must support many-to-many links.

### Order Dashboard

Each Supplier Order (or Customer Order) should have its own dashboard. Display at the top: Order Number, Supplier/Customer, Current Status, Progress %, Total Ordered, Total Delivered, Total Invoiced, Total Paid, Remaining to Deliver, Remaining to Invoice, Remaining to Pay, Remaining to Receive. Display these as large KPI cards.

### Financial Timeline

Create a chronological timeline showing every event (PO Created → Deposit Requested → Deposit Paid → Delivery Note #1 → Invoice #1 → Transfer #1 → Delivery Note #2 → Invoice #2 → Transfer #2 → Credit Note → Order Closed). Every item should be clickable.

### Reconciliation View

The most important feature. Show a graphical reconciliation between Purchase Orders → Delivery Notes → Invoices → Payments. Each block displays: document number, amount, remaining amount, status, color. Hovering over a document highlights every connected document. This should look like a network/flow diagram rather than a spreadsheet.

### Status System

Every document automatically receives a status (Draft, Waiting, Partially Delivered, Delivered, Partially Invoiced, Fully Invoiced, Partially Paid, Paid, Overpaid, Cancelled, Blocked, Missing Documents). Statuses update automatically.

### Payment Analysis

Display: total amount, already paid, deposit paid, remaining balance, expected payment, late payment, overpayment, payment history. Each payment shows which invoices it covers; each invoice shows which payments contribute to it.

### Delivery Analysis

Display: ordered quantity, delivered quantity, remaining quantity, delivery percentage, expected deliveries, late deliveries, partial deliveries.

### Alerts

Automatically detect: missing invoice, missing delivery note, invoice without PO, payment without invoice, invoice exceeding PO amount, overpayment, duplicate payment, currency mismatch, unlinked document, late payment, late delivery. Every anomaly appears in a dedicated alert panel.

### Search & Filters

Global search by PO, Invoice, Delivery Note, Supplier, Customer, Transfer, Amount, Reference, Date. Filters by Supplier, Customer, Year (spec continues beyond what was captured in this export).

## Scoping decisions (from clarifying questions)

- **Scope for v1**: Visual prototype (no backend) — rich mock data across Dashboard, Order view, Timeline, Reconciliation graph, Alerts. No auth, no DB.
- **Perspective**: Both supplier (payable) and customer (receivable) sides from day one, unified model with a toggle.
- **Design direction**: Requested rendered directions; the design-tool couldn't produce them for a greenfield build, so the agent asked direct visual-preference questions instead (see below).

## Design brief (given to the design tool)

- **Description**: Internal financial reconciliation platform for a fashion company. Order dashboard view: KPI cards (Total Ordered, Delivered, Invoiced, Paid, Remaining), chronological financial timeline, and a visual reconciliation flow linking POs → Delivery Notes → Invoices → Payments. Both supplier (payable) and customer (receivable) sides. Users are finance teams — they need to understand an order's status in 10 seconds.
- **Product contract**: Order header (ID, supplier/customer, status, progress %), KPI card row, vertical timeline of events, graphical reconciliation view (PO/DN/Invoice/Payment blocks connected by lines), alerts strip, global search bar, nav for Dashboard/Orders/Reconciliation/Alerts.
- **Sensory metaphor**: A calm control room where every flow of money and goods clicks into place like a mechanical clearing house.
- **Energy**: Quiet, precise, financial-grade clarity — not ERP-dense, not consumer-playful.
- **References**: Linear, Stripe Dashboard, Ramp, Pennylane, Notion, Mercury.
- **Structural moves**: Order dashboard as hero surface — KPI grid on top, timeline on one side, flow-diagram reconciliation on the other. Status via subtle color chips, not loud badges. Nodes-and-edges reconciliation instead of tables.
- **Motion intent**: Subtle — hover on a document node fades unrelated nodes and highlights connection paths; KPI numbers count up on load; timeline items slide in.
- **Guardrails**: Must feel like a serious finance tool. No purple gradients, no marketing hero. Data central but never cluttered. Support both payable and receivable perspectives.

## Final visual choices

- **Palette**: Navy Trust — crisp navy + white (`#fafbfc`, `#e8ecf1`, `#0f1b3d`, `#3b6fa0`). Serious finance feel.
- **Typography**: Instrument Serif (headings/KPI numbers) + Work Sans (body).
- **Mode**: Light by default, with a dark-mode toggle.

## Tech stack (as built)

TanStack Start (TypeScript), Tailwind, shadcn/ui components, Bun. No backend — mock data only (`src/lib/mock.ts`).

## Routes built

- `/` — home dashboard (portfolio metrics + alerts)
- `/orders` — combined supplier + customer orders list
- `/orders/$id` — order detail (KPIs, timeline, reconciliation flow)
- `/reconciliation` — standalone reconciliation view
- `/alerts` — alerts panel
- `/suppliers`, `/customers` — entity lists

---

Ce fichier sert de référence pour toute reprise du projet. Les fichiers source (composants, routes, styles) sont dans ce même dossier — c'est désormais un projet local à modifier uniquement via Claude Code, plus via Lovable.
