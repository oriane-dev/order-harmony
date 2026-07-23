import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Separate, self-contained config for the "download as one HTML file" export.
// Deliberately does NOT use @lovable.dev/vite-tanstack-config — that wrapper always
// pulls in TanStack Start's SSR preset + Nitro/Cloudflare build, with no CSR-only mode.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    tsconfigPaths: true,
  },
  // __root.tsx normally adds a <link rel="stylesheet" href={appCss}> pointing at the
  // real styles.css chunk — needed for the SSR app, but for this single-file export the
  // CSS is already inlined via <style> by vite-plugin-singlefile. Without this flag the
  // extra <link> points at a chunk that no longer exists standalone, and the browser
  // hangs waiting on that stylesheet to load (the "search bar freezes the page" bug).
  define: {
    "import.meta.env.VITE_STANDALONE": JSON.stringify(true),
  },
  build: {
    outDir: "dist-standalone",
    emptyOutDir: true,
    rollupOptions: {
      input: "standalone/index.html",
    },
  },
});
