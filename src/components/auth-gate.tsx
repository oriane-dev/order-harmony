import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Loader2,
  Lock,
  Mail,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AUTH_ENABLED,
  useSession,
  signInWithPassword,
  updatePassword,
  sendPasswordReset,
} from "@/lib/auth";

// --- Détection d'un lien d'invitation / de réinitialisation ------------------
// Quand quelqu'un clique le lien reçu par e-mail, Supabase vérifie le jeton puis
// renvoie sur cette page en ajoutant `#...&type=invite` (ou `type=recovery`) à
// l'URL. On capture ce paramètre AU CHARGEMENT DU MODULE (synchrone), avant que
// Supabase ne nettoie l'URL : c'est ce qui bascule la page en mode « définir un
// mot de passe » plutôt qu'en simple connexion.
type RecoveryInfo = { mode: "invite" | "recovery"; error: string | null };

function readRecoveryFromUrl(): RecoveryInfo | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : "";
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const type = p.get("type");
  const errorDesc = p.get("error_description") || p.get("error_code") || p.get("error");
  if (type === "invite" || type === "recovery") {
    return { mode: type, error: errorDesc ? decodeURIComponent(errorDesc) : null };
  }
  // Lien expiré / déjà utilisé : Supabase renvoie une erreur sans `type`.
  if (errorDesc) return { mode: "recovery", error: decodeURIComponent(errorDesc) };
  return null;
}

const INITIAL_RECOVERY = readRecoveryFromUrl();

// --- Écran de connexion (avec sous-mode « mot de passe oublié ») -------------
export function LoginScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Email ou mot de passe incorrect."
          : error.message,
      );
      return;
    }
    onSignedIn?.();
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await sendPasswordReset(email);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell>
      {forgot ? (
        sent ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="size-8 text-primary mx-auto" />
            <div>
              <h1 className="font-serif text-2xl">E-mail envoyé</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Si un compte existe pour <span className="font-medium">{email}</span>, un
                lien de réinitialisation vient d'être envoyé. Ouvre-le pour définir un
                nouveau mot de passe.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setForgot(false);
                setSent(false);
              }}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Retour à la connexion
            </button>
          </div>
        ) : (
          <form onSubmit={onForgot} className="space-y-4">
            <div>
              <h1 className="font-serif text-2xl">Mot de passe oublié</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Entre ton email : tu recevras un lien pour définir un nouveau mot de passe.
              </p>
            </div>
            <Field
              id="email"
              label="Email"
              icon={Mail}
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              placeholder="prenom@entreprise.com"
            />
            {error && <ErrorLine>{error}</ErrorLine>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Envoyer le lien
            </Button>
            <button
              type="button"
              onClick={() => setForgot(false)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Retour à la connexion
            </button>
          </form>
        )
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <h1 className="font-serif text-2xl">Connexion</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Entre tes identifiants pour accéder au tableau de bord.
            </p>
          </div>
          <Field
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="prenom@entreprise.com"
          />
          <Field
            id="password"
            label="Mot de passe"
            icon={Lock}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
          {error && <ErrorLine>{error}</ErrorLine>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Se connecter
          </Button>
          <button
            type="button"
            onClick={() => {
              setForgot(true);
              setError(null);
            }}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Mot de passe oublié ?
          </button>
        </form>
      )}
    </AuthShell>
  );
}

// --- Écran « définir un mot de passe » (invitation / réinitialisation) --------
export function SetPasswordScreen({
  info,
  onDone,
}: {
  info: RecoveryInfo;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(info.error);

  const linkBroken = Boolean(info.error);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) {
      setError(
        /session|auth|jwt|expired/i.test(error.message)
          ? "Le lien a expiré ou a déjà été utilisé. Redemande une invitation ou un lien de réinitialisation."
          : error.message,
      );
      return;
    }
    onDone();
  }

  const heading = info.mode === "invite" ? "Bienvenue" : "Nouveau mot de passe";
  const intro =
    info.mode === "invite"
      ? "Choisis un mot de passe pour activer ton accès."
      : "Choisis un nouveau mot de passe pour ton compte.";

  return (
    <AuthShell>
      {linkBroken ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="size-6 shrink-0 text-destructive mt-0.5" />
            <div>
              <h1 className="font-serif text-2xl">Lien invalide</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Ce lien a expiré ou a déjà été utilisé. Demande à l'administrateur une
                nouvelle invitation, ou utilise « mot de passe oublié » sur l'écran de
                connexion.
              </p>
            </div>
          </div>
          <Button type="button" className="w-full" onClick={onDone}>
            Aller à la connexion
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <h1 className="font-serif text-2xl">{heading}</h1>
            <p className="text-sm text-muted-foreground mt-1">{intro}</p>
          </div>
          <Field
            id="password"
            label="Mot de passe"
            icon={KeyRound}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            placeholder="Au moins 8 caractères"
          />
          <Field
            id="confirm"
            label="Confirmer le mot de passe"
            icon={KeyRound}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            placeholder="••••••••"
          />
          {error && <ErrorLine>{error}</ErrorLine>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Définir le mot de passe et continuer
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

// --- Petits composants partagés ---------------------------------------------
function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="size-9 shrink-0 rounded-lg bg-primary flex items-center justify-center">
            <span className="font-serif text-primary-foreground text-xl leading-none">C</span>
          </div>
          <div className="text-left">
            <div className="font-serif text-lg leading-tight">Cash Flow Management</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Rapprochement
            </div>
          </div>
        </div>
        <div className="card-elev p-7">{children}</div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Accès réservé. Contacte l'administrateur si tu n'as pas d'identifiants.
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          id={id}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9"
          {...rest}
        />
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// --- Barrière d'authentification --------------------------------------------
// Priorités :
//  1. Lien d'invitation / réinitialisation détecté dans l'URL → écran « définir
//     un mot de passe » (même si l'auth n'est pas encore imposée : on honore le lien).
//  2. Interrupteur off (VITE_AUTH_ENABLED ≠ "true") → accès direct (écran prêt, non appliqué).
//  3. Interrupteur on → session requise, sinon écran de connexion.
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  // Le drapeau `mounted` évite tout décalage d'hydratation : le serveur ne voit
  // jamais le fragment d'URL (#...), donc on n'active le mode récupération
  // qu'après le montage côté client.
  const [mounted, setMounted] = useState(false);
  const [recoveryDone, setRecoveryDone] = useState(false);
  useEffect(() => setMounted(true), []);

  if (mounted && INITIAL_RECOVERY && !recoveryDone) {
    return (
      <SetPasswordScreen info={INITIAL_RECOVERY} onDone={() => setRecoveryDone(true)} />
    );
  }

  if (!AUTH_ENABLED) return <>{children}</>;
  if (loading) return <FullScreenLoader />;
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}
