// Raw Thalae/Supabase row shapes — the exact JSON Thalae itself reads and writes
// (both tables are plain jsonb blob stores, keyed by id). Shared by the read-side
// adapter (thalae-adapter.ts), the mutation layer (thalae-mutations.ts), and the
// extraction pipeline (thalae-extract.ts). Keep in sync with Thalae's own source
// (`suivi-commandes-2.html`) — any field this repo doesn't know about is still
// preserved at runtime as long as mutations always spread the existing object
// rather than reconstructing one field-by-field.

export interface RawPdf {
  id: string;
  url?: string;
  name?: string;
  size?: number;
}

export interface RawPayment {
  id: string;
  montant?: number;
  date?: string;
  devise?: string;
  pdf?: RawPdf | null;
}

export interface RawFacture {
  id: string;
  pdf?: RawPdf | null;
  montant?: number;
  montantBrut?: number;
  devise?: string;
}

export interface RawPackingList {
  id: string;
  packingListPdf?: RawPdf | null;
  paiements?: RawPayment[];
  factures?: RawFacture[];
  // legacy flat shape, still populated alongside factures[] on real rows
  facturePdf?: RawPdf | null;
  factureAmount?: number;
  factureMontantBrut?: number;
}

export interface RawDocFlowSlot {
  pdf?: RawPdf | null;
  montant?: number;
  devise?: string;
  paiements?: RawPayment[];
}

export interface RawDocFlow {
  poDocument?: RawPdf | null;
  proforma?: RawDocFlowSlot;
  packingLists?: RawPackingList[];
  // undocumented in the old app's code, present on every real docFlow row
  factureDefinitive?: RawDocFlowSlot;
}

export interface RawAttachment {
  id: string;
  name?: string;
  size?: number;
  url?: string;
  paiements?: RawPayment[];
}

// Legacy shape — 0 real rows use this today, kept only so old data doesn't crash.
export interface RawMilestone {
  id: string;
  label?: string;
  amount?: number;
  percent?: number;
  triggerType?: "date" | "event";
  dueDate?: string;
  triggerEvent?: string;
  daysAfterEvent?: number;
  paid?: boolean;
  paidAt?: string;
  activated?: boolean;
  activatedAt?: string;
}

export interface RawLegacyDocument {
  id: string;
  type?: string;
  reference?: string;
  notes?: string;
  lignes?: unknown[];
  milestones?: RawMilestone[];
}

export interface RawOrder {
  id: string;
  reference?: string;
  fournisseur?: string;
  fournisseurId?: string;
  produit?: string;
  montant?: number;
  devise?: string;
  dateCommande?: string;
  dateLivraison?: string;
  createdAt?: string;
  incoterms?: string;
  notes?: string;
  quantite?: number;
  nop?: number;
  progressProduction?: number;
  progressLivraison?: number;
  statusProduction?: "en_attente" | "en_cours" | "termine";
  statusLivraison?: "en_attente" | "expedie" | "en_transit" | "recu";
  attachments?: RawAttachment[];
  documents?: RawLegacyDocument[];
  docFlow?: RawDocFlow;
}

export interface RawConditionPaiement {
  id: string;
  label: string;
  percent: number;
  triggerType: "date_order" | "event";
  triggerEvent?: string;
  daysAfterOrder?: number;
  daysAfterEvent?: number;
}

export interface RawSupplier {
  id: string;
  nom?: string;
  pays?: string;
  adresse?: string;
  email?: string;
  telephone?: string;
  devise?: string;
  incoterms?: string;
  conditionsPaiementText?: string;
  conditionsPaiement?: RawConditionPaiement[];
  notes?: string;
}
