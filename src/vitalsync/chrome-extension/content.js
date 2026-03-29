// VitalSync Content Script — receives Garmin cookies from the extension popup
// Injected on vitalsync-7e04b.web.app pages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VITALSYNC_GARMIN_COOKIES' && message.cookieHeader) {
    // Dispatch a custom event that the React app can listen for
    window.dispatchEvent(new CustomEvent('vitalsync-garmin-cookies', {
      detail: { cookieHeader: message.cookieHeader },
    }));
    sendResponse({ ok: true });
  }
});
