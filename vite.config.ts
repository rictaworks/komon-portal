import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** Writes the fixed notification text for the service worker from the language pack, so it is defined in one place. */
function notificationText(): Plugin {
  return {
    name: "komon-notification-text",
    generateBundle() {
      const messages = JSON.parse(readFileSync("src/locales/en.json", "utf8")) as { notification: { title: string; body: string } };
      this.emitFile({ type: "asset", fileName: "notification.json", source: JSON.stringify(messages.notification) });
    },
  };
}

export default defineConfig({
  root: "src/app/web",
  publicDir: "public",
  plugins: [react(), notificationText()],
  build: {
    outDir: "../../../dist/client",
    emptyOutDir: true,
  },
});
