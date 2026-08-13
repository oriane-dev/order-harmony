import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveOrder } from "@/lib/thalae-mutations";
import { rawSuppliersQueryOptions, rawCustomersQueryOptions } from "@/lib/data";
import type { RawOrder } from "@/lib/thalae-types";
import { ENTITIES, type Entity } from "@/lib/entities";

const MANUAL = "__manual__";

const schema = z.object({
  reference: z.string().min(1, "Requis"),
  supplierId: z.string(), // real supplier id, or MANUAL
  fournisseurManual: z.string().optional(),
  produit: z.string().optional(),
  montant: z.coerce.number().min(0, "Doit être positif"),
  devise: z.enum(["EUR", "USD", "GBP", "CNY"]),
  dateLivraison: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
const tod = () => new Date().toISOString().slice(0, 10);

function toFormValues(o?: RawOrder): FormValues {
  return {
    reference: o?.reference ?? "",
    supplierId: o?.fournisseurId || MANUAL,
    fournisseurManual: o?.fournisseur ?? "",
    produit: o?.produit ?? "",
    montant: o?.montant ?? 0,
    devise: (o?.devise as FormValues["devise"]) ?? "EUR",
    dateLivraison: o?.dateLivraison ?? "",
    notes: o?.notes ?? "",
  };
}

export function OrderForm({
  open,
  onOpenChange,
  order,
  entity = "supplier",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: RawOrder;
  entity?: Entity;
}) {
  const cfg = ENTITIES[entity];
  const queryClient = useQueryClient();
  const partyOptions =
    entity === "customer" ? rawCustomersQueryOptions() : rawSuppliersQueryOptions();
  const { data: parties = [] } = useQuery({ ...partyOptions, enabled: open });
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(order),
  });

  useEffect(() => {
    if (open) form.reset(toFormValues(order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order]);

  const supplierId = form.watch("supplierId");

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const party = parties.find((s) => s.id === values.supplierId);
      const next: RawOrder = {
        ...order,
        id: order?.id ?? uid(),
        createdAt: order?.createdAt ?? tod(),
        reference: values.reference,
        fournisseurId: party?.id ?? "",
        fournisseur: party?.nom ?? values.fournisseurManual ?? "",
        produit: values.produit,
        montant: values.montant,
        devise: values.devise,
        dateLivraison: values.dateLivraison,
        notes: values.notes,
        attachments: order?.attachments ?? [],
        documents: order?.documents ?? [],
      };
      await saveOrder(next, cfg.ordersTable);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{order ? "Modifier la commande" : "Nouvelle commande"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Référence</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="100088" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{cfg.party}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={MANUAL}>— Saisie libre —</SelectItem>
                      {parties
                        // a Radix SelectItem must have a non-empty value — skip any
                        // party record with a missing id (would crash the whole select)
                        .filter((s) => s.id && s.nom)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.nom}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {supplierId === MANUAL && (
              <FormField
                control={form.control}
                name="fournisseurManual"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom du {cfg.party.toLowerCase()}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={`Nom du ${cfg.party.toLowerCase()}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="produit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Produit</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Production SS26" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="montant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Montant</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="devise"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Devise</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(["EUR", "USD", "GBP", "CNY"] as const).map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="dateLivraison"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Livraison prévue</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {mutation.isError && (
              <p className="text-sm text-destructive">
                {(mutation.error as Error).message || "Échec de l'enregistrement."}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
