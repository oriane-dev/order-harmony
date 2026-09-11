import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock, Mail, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH_ENABLED, useSession, signInWithPassword } from "@/lib/auth";

// Écran de connexion — email + mot de passe. Design aligné sur l'app.
export function LoginScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Marque */}
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

        <div className="card-elev p-7">
          <h1 className="font-serif text-2xl">Connexion</h1>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            Entre tes identifiants pour accéder au tableau de bord.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom@entreprise.com"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Se connecter
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Accès réservé. Contacte l'administrateur si tu n'as pas d'identifiants.
        </p>
      </div>
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

// Barrière d'authentification autour de l'application.
// - Interrupteur off (VITE_AUTH_ENABLED ≠ "true") → accès direct (écran prêt, non appliqué).
// - Interrupteur on → session requise, sinon écran de connexion.
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (!AUTH_ENABLED) return <>{children}</>;
  if (loading) return <FullScreenLoader />;
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}
