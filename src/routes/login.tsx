import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LoginScreen } from "@/components/auth-gate";

// Page de connexion accessible directement (aperçu du design + point d'entrée
// quand l'authentification est activée). Après connexion → tableau de bord.
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Connexion · Cash Flow Management" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  return <LoginScreen onSignedIn={() => router.navigate({ to: "/" })} />;
}
