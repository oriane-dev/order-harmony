// Authentification Supabase (email + mot de passe).
//
// Interrupteur : tant que VITE_AUTH_ENABLED n'est pas "true", l'app s'ouvre
// directement (l'écran de connexion est prêt mais NON appliqué). Le jour où des
// utilisateurs sont créés dans Supabase, mettre VITE_AUTH_ENABLED="true" (dans
// Netlify) et l'écran garde l'accès. Voir aussi la page /login pour un aperçu.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === "true";

// Session courante + état de chargement, tenue à jour en temps réel.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

export function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export function signOut() {
  return supabase.auth.signOut();
}

// Définit (ou change) le mot de passe de l'utilisateur actuellement en session.
// Utilisé après un lien d'invitation ou de réinitialisation : le lien a déjà
// ouvert une session (Supabase la détecte dans l'URL), il ne reste qu'à choisir
// un mot de passe.
export function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

// Envoie l'e-mail « mot de passe oublié ». Le lien reçu ramène sur cette même
// page avec un jeton de récupération, qui déclenche l'écran « définir un mot de
// passe ». `redirectTo` doit figurer dans les Redirect URLs autorisées de Supabase.
export function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
}
