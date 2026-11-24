import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app/web",
  plugins: [react()],
  build: {
    outDir: "../../../dist/client",
    emptyOutDir: true,
  },
});
