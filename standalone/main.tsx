import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, createHashHistory, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "../src/routeTree.gen";
// Import as a raw string and inject manually — the shared __root.tsx's SSR-only
// head() config references the CSS via a hashed `?url` asset link, and TanStack
// Router auto-syncs that into document.head on the client regardless of SSR.
// That link 404s in this single-file build (no separate CSS file exists), so we
// inject the real compiled styles ourselves instead of relying on it.
import appStyles from "../src/styles.css?inline";

const styleEl = document.createElement("style");
styleEl.textContent = appStyles;
document.head.appendChild(styleEl);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createHashHistory(),
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
