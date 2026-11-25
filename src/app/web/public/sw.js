/* Service worker for browser notifications. The push message carries no data; the text is fixed. */
const TEXT_URL = "/notification.json";

async function notificationText() {
  const response = await fetch(TEXT_URL, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("notification text is unavailable");
  }
  return response.json();
}

async function showNewDocument() {
  // A push must always show something. If the text cannot be loaded, the failure is logged explicitly.
  const text = await notificationText().catch((error) => {
    console.error("komon: cannot load the notification text", error);
    throw error;
  });
  await self.registration.showNotification(text.title, { body: text.body, tag: "new-document" });
}

async function openPortal() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => "focus" in client);
  if (existing) {
    await existing.focus();
    return;
  }
  await self.clients.openWindow("/");
}

self.addEventListener("push", (event) => {
  event.waitUntil(showNewDocument());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openPortal());
});
