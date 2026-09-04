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

// A credit note (avoir) attached to an invoice — reduces the invoiced amount.
// `montant` is stored as a positive credit value; it is SUBTRACTED from the invoice
// it belongs to (so the net facturé comes out lower).
export interface RawCreditNote {
  id: string;
  docNo?: string; // e.g. "CN-00536"
  montant?: number; // positive credit amount, subtracted from the invoice
  devise?: string;
  pdf?: RawPdf | null;
  docDate?: string; // ISO
  date?: string; // ISO
}

// Un retour marchandise : une Return Authorisation (RA) et son avoir (CN) de MÊME
// montant, importés sur la même ligne de commande. Purement informatif — n'affecte NI
// le montant facturé, NI la trésorerie (l'échéancier reste calé sur le total commandé).
export interface RawReturn {
  id: string;
  raNo?: string; // ex. "RA-00022"
  cnNo?: string; // ex. "CN-00526"
  soLine?: string; // ex. "SO-00029/1" (référence SO de la ligne concernée)
  montant?: number;
  devise?: string;
  docDate?: string; // ISO
  qty?: number;
  raPdf?: RawPdf | null;
  cnPdf?: RawPdf | null;
}

export interface RawFacture {
  id: string;
  pdf?: RawPdf | null;
  montant?: number;
  montantBrut?: number;
  devise?: string;
  // business metadata from the document-level customer import (harmless to suppliers)
  docNo?: string; // e.g. "IN-500632" — invoice number, used for dedup / PDF matching
  docDate?: string; // ISO
  dueDate?: string; // ISO — invoice payment due date
  creditNotes?: RawCreditNote[]; // avoirs reducing this invoice
}

// « Pro forma pour livraison » — une demande de paiement partielle du Before Shipment,
// reçue (souvent par mail) avant la facture définitive. Document PDF OU image, avec un
// montant et une date d'échéance obligatoires, et sa/ses preuve(s) de paiement.
export interface RawLivraisonProforma {
  id: string;
  pdf?: RawPdf | null; // PDF ou image (capture d'écran, etc.)
  montant?: number; // montant demandé (obligatoire)
  dueDate?: string; // ISO — date de paiement / échéance (obligatoire)
  paiements?: RawPayment[]; // preuve(s) de paiement
}

export interface RawPackingList {
  id: string;
  packingListPdf?: RawPdf | null;
  paiements?: RawPayment[];
  factures?: RawFacture[];
  // demandes de paiement partielles du Before Shipment reçues pour cette livraison
  livraisonProformas?: RawLivraisonProforma[];
  // legacy flat shape, still populated alongside factures[] on real rows
  facturePdf?: RawPdf | null;
  factureAmount?: number;
  factureMontantBrut?: number;
  // business metadata from the document-level customer import
  docNo?: string; // e.g. "DN-00293" — delivery note number
  docDate?: string; // ISO
  qty?: number;
}

// A deposit invoice (facture d'acompte) — the formal invoicing of the pro forma
// deposit. Lives UNDER the pro forma slot (a pro forma can have several). It is a
// real invoice: its amount counts as facturé and its payments as encaissé, exactly
// like it did when it was (wrongly) stored as a delivery facture.
export interface RawDepositInvoice {
  id: string;
  docNo?: string; // e.g. "IN-500571"
  montant?: number;
  devise?: string;
  pdf?: RawPdf | null;
  docDate?: string; // ISO
  dueDate?: string; // ISO
  paiements?: RawPayment[];
  creditNotes?: RawCreditNote[]; // avoirs reducing this deposit invoice
}

export interface RawDocFlowSlot {
  pdf?: RawPdf | null;
  montant?: number;
  devise?: string;
  paiements?: RawPayment[];
  // business metadata from the document-level customer import
  docNo?: string; // e.g. "PF-00015" — pro forma number
  docDate?: string; // ISO
  dueDate?: string; // ISO
  // deposit invoices billed against this pro forma (facturé + encaissé)
  depositInvoices?: RawDepositInvoice[];
}

export interface RawDocFlow {
  poDocument?: RawPdf | null;
  proforma?: RawDocFlowSlot;
  packingLists?: RawPackingList[];
  // undocumented in the old app's code, present on every real docFlow row
  factureDefinitive?: RawDocFlowSlot;
  // retours marchandise (paires RA + CN) — informatif, sans effet sur les totaux
  returns?: RawReturn[];
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

// Free-text notes/discussion attached to an order as a whole. New field added by this
// app (not part of Thalae's original schema); harmless to Thalae, which preserves
// unknown fields on the data blob as long as it spreads the existing object.
export interface RawComment {
  id: string;
  text: string;
  author?: string;
  createdAt: string; // ISO timestamp
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
  comments?: RawComment[];
  // Manually marked as closed by the user — forces the status to "closed" and clears
  // its alerts, e.g. when the order was legitimately revised so "facture > bon de
  // commande" is expected. New field (Thalae preserves unknown fields).
  cloture?: boolean;
  // Archivée par l'utilisateur — la commande reste consultable mais disparaît de
  // l'échéancier et du calendrier (on ne la supprime pas). New field.
  archived?: boolean;
  // Identifiants d'alertes marquées « ce n'est pas une erreur » par l'utilisateur
  // (ex. "a:<id>:invoice_exceeds_po") — l'alerte reste calculée mais est masquée. New field.
  acknowledgedAlerts?: string[];
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
