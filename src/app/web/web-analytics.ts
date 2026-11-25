/**
 * Whether Cloudflare Web Analytics is switched on for this deployment. The Worker adds the beacon
 * script to the page only when a token is configured, so its presence is the setting.
 */
export function webAnalyticsEnabled(page: Document): boolean {
  return page.querySelector("script[data-cf-beacon]") !== null;
}
