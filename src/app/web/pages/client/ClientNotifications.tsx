import { useParams } from "react-router-dom";
import { base64UrlToBytes } from "../../api/base64url";
import type { NotificationStatus } from "../../api/client-types";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

/** Browser notifications for this device. The push carries no content; the service worker shows a fixed notice. */
export function ClientNotifications() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const status = useLoad<NotificationStatus>(() => api.get<NotificationStatus>(`/api/client/${clientId}/notifications`), [clientId]);
  const action = useAction();
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  const enable = () => {
    void action.run(async () => {
      const publicKey = status.data?.vapidPublicKey ?? null;
      if (publicKey === null) {
        throw new Error("notifications are not configured");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("notification permission was not granted");
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const json = subscription.toJSON();
      if (json.endpoint === undefined || json.keys === undefined) {
        throw new Error("the browser returned an incomplete subscription");
      }
      await api.post(`/api/client/${clientId}/notifications/subscriptions`, { endpoint: json.endpoint, keys: json.keys });
      status.reload();
    });
  };

  const disable = () => {
    void action.run(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription === null || subscription === undefined) {
        return;
      }
      await api.delete(`/api/client/${clientId}/notifications/subscriptions`, { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      status.reload();
    });
  };

  if (status.data === null) {
    return status.error === null ? <Loading /> : <ErrorNotice error={status.error} />;
  }
  return (
    <div className="page">
      <h1 className="title">{t("client.notifications.title")}</h1>
      <p className="muted">{t("client.notifications.lead")}</p>
      <ErrorNotice error={action.error} />
      {!supported ? <Notice tone="review">{t("client.notifications.unsupported")}</Notice> : null}
      {!status.data.available ? <Notice tone="review">{t("client.notifications.notConfigured")}</Notice> : null}
      {supported && status.data.available ? (
        <div className="card card--pad stack">
          <span>{status.data.subscriptions > 0 ? t("client.notifications.onThisDevice") : t("client.notifications.offThisDevice")}</span>
          <div className="row">
            <button type="button" className="button button--primary" disabled={action.busy || status.data.subscriptions > 0} onClick={enable}>
              {t("client.notifications.enable")}
            </button>
            <button type="button" className="button" disabled={action.busy || status.data.subscriptions === 0} onClick={disable}>
              {t("client.notifications.disable")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
