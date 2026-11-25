import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

function notificationTextOf(): { title: string; body: string } {
  const messages = JSON.parse(readFileSync("src/locales/en.json", "utf8")) as { notification: { title: string; body: string } };
  return messages.notification;
}

/** Writes the fixed notification text for the service worker from the language pack, so it is defined in one place. */
function notificationText(): Plugin {
  return {
    name: "komon-notification-text",
    configureServer(server) {
      // The development server serves the same text, so a push works while developing.
      server.middlewares.use("/notification.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(notificationTextOf()));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "notification.json", source: JSON.stringify(notificationTextOf()) });
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
