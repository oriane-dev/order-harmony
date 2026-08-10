import { Link, useRouterState } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  FileStack,
  ShoppingCart,
  Network,
  BellDot,
  Truck,
  Users,
  CalendarClock,
  CalendarRange,
  Search,
  Moon,
  Sun,
  Command,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { globalAlerts as computeGlobalAlerts } from "@/lib/ledger-types";
import { ordersQueryOptions, customerOrdersQueryOptions } from "@/lib/data";
import { useOrdersRealtimeSync } from "@/hooks/use-orders-realtime";
import { SettingsDialog } from "@/components/settings-dialog";
import { OrderLink } from "@/components/order-link";

const nav = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/orders", label: "Commandes fournisseurs", icon: FileStack },
  { to: "/customer-orders", label: "Commandes clients", icon: ShoppingCart },
  { to: "/reconciliation", label: "Rapprochement", icon: Network },
  { to: "/alerts", label: "Alertes", icon: BellDot },
  { to: "/suppliers", label: "Fournisseurs", icon: Truck },
  { to: "/customers", label: "Clients", icon: Users },
  { to: "/echeances", label: "Échéances", icon: CalendarClock },
  { to: "/calendrier", label: "Calendrier", icon: CalendarRange },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const globalAlerts = computeGlobalAlerts([...orders, ...customerOrders]);
  useOrdersRealtimeSync();
  const [dark, setDark] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    if (stored === "dark") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Matching ids rather than a filtered array: every order's <Link> stays mounted for
  // the modal's whole lifetime and is merely shown/hidden via CSS as `q` changes. Actually
  // filtering the array (unmounting non-matches, mounting new ones each keystroke) made
  // clicking a just-filtered-in result hang the standalone export outright — clicking a
  // result present since the modal opened was always fine, only freshly (re)mounted
  // results triggered it.
  const allOrders = useMemo(() => [...orders, ...customerOrders], [orders, customerOrders]);
  const matchIds = useMemo(() => {
    if (!q) return null;
    const needle = q.toLowerCase();
    return new Set(
      allOrders
        .filter(
          (o) =>
            o.number.toLowerCase().includes(needle) ||
            o.party.name.toLowerCase().includes(needle) ||
            o.docs.some((d) => d.number.toLowerCase().includes(needle)),
        )
        .map((o) => o.id),
    );
  }, [q, allOrders]);
  const hasResults = matchIds === null || matchIds.size > 0;

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar sticky top-0 h-screen flex flex-col">
        <div className="px-5 pt-6 pb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-7 rounded-md bg-primary flex items-center justify-center">
              <span className="font-serif text-primary-foreground text-lg leading-none">L</span>
            </div>
            <div>
              <div className="font-serif text-lg leading-none">Ledger</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Rapprochement
              </div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            const alertCount = n.to === "/alerts" ? globalAlerts.length : 0;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{n.label}</span>
                {alertCount > 0 && (
                  <span
                    className={cn(
                      "text-[10px] rounded-full px-1.5 py-0.5",
                      active ? "bg-primary-foreground/20" : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-medium text-accent-foreground">
              CR
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">Camille Rousseau</div>
              <div className="text-xs text-muted-foreground truncate">Finance · Admin</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-8 py-3.5">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex-1 max-w-xl flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-border bg-surface hover:bg-surface-2 text-sm text-muted-foreground transition-colors"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">
                Rechercher une commande, une facture, un BC, un virement…
              </span>
              <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                <Command className="size-3" /> K
              </kbd>
            </button>
            <button
              onClick={toggleTheme}
              className="size-9 grid place-items-center rounded-lg border border-border hover:bg-surface-2 transition-colors"
              aria-label="Changer de thème"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="size-9 grid place-items-center rounded-lg border border-border hover:bg-surface-2 transition-colors"
              aria-label="Paramètres"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-start justify-center pt-24"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl card-elev overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Search className="size-4 text-muted-foreground" />
              {/* No autoFocus/programmatic focus() here: focusing this input hangs the
                  standalone (single-file) export entirely on mount — click to type instead. */}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un BC, une facture, une livraison, un virement, un fournisseur…"
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                Esc
              </kbd>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {!hasResults && (
                <div className="p-6 text-sm text-muted-foreground text-center">Aucun résultat</div>
              )}
              {allOrders.map((o) => (
                <OrderLink
                  key={o.id}
                  order={o}
                  onClick={() => setSearchOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 hover:bg-surface-2",
                    matchIds !== null && !matchIds.has(o.id) && "hidden",
                  )}
                >
                  <div className="text-xs uppercase text-muted-foreground w-14">
                    {o.side === "payable" ? "BC" : "BV"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{o.number}</div>
                    <div className="text-xs text-muted-foreground truncate">{o.party.name}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{o.currency}</div>
                </OrderLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
