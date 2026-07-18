import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Redireciona o server entry padrão do TanStack Start pro nosso
      // wrapper de SSR em src/server.ts (trata erros que o h3 engoliria).
      server: { entry: "server" },
    }),
    viteReact(),
    nitro(),
  ],
});
