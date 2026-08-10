import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as M from "@/lib/thalae-mutations";
import type { RawOrder } from "@/lib/thalae-types";
import { ENTITIES, type Entity } from "@/lib/entities";
import { MessageSquare, Trash2, Send } from "lucide-react";

function useOrderMutation(orderId: string, entity: Entity) {
  const queryClient = useQueryClient();
  const cfg = ENTITIES[entity];
  return useMutation({
    scope: { id: `order-mutation-${orderId}` },
    mutationFn: async (updater: (order: RawOrder) => RawOrder) => {
      const orders = queryClient.getQueryData<RawOrder[]>(cfg.rawOrdersKey) ?? [];
      const current = orders.find((o) => o.id === orderId);
      if (!current) throw new Error("Commande introuvable dans le cache.");
      const next = updater(current);
      // write back before the async save so rapid successive actions read fresh state
      queryClient.setQueryData<RawOrder[]>(cfg.rawOrdersKey, (old) =>
        (old ?? []).map((o) => (o.id === orderId ? next : o)),
      );
      await M.saveOrder(next, cfg.ordersTable);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cfg.ordersKey }),
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      alert(e.message || "Une erreur est survenue.");
    },
  });
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderComments({
  order,
  entity = "supplier",
}: {
  order: RawOrder;
  entity?: Entity;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const mutation = useOrderMutation(order.id, entity);
  const comments = order.comments ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // keep the thread scrolled to the latest note when it opens or grows
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, comments.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    mutation.mutate((o) => M.addComment(o, text));
    setDraft("");
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquare /> Commentaires
        {comments.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] min-w-4 h-4 px-1">
            {comments.length}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Commentaires · {order.reference || order.id}</DialogTitle>
          </DialogHeader>

          <div ref={scrollRef} className="max-h-[45vh] overflow-y-auto space-y-3 pr-1">
            {comments.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                Aucune note pour l'instant. Écris la première ci-dessous.
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="group bg-surface-2 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {fmtWhen(c.createdAt)}
                  </span>
                  <button
                    onClick={() => mutation.mutate((o) => M.deleteComment(o, c.id))}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Supprimer la note"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="whitespace-pre-wrap break-words">{c.text}</div>
              </div>
            ))}
          </div>

          <div className="flex items-end gap-2 pt-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ajouter une note… (Cmd/Ctrl + Entrée pour envoyer)"
              rows={2}
              className="flex-1 resize-none"
            />
            <Button
              size="icon"
              onClick={submit}
              disabled={mutation.isPending || !draft.trim()}
              aria-label="Envoyer"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
