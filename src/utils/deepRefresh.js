let deepRefreshStarted = false;

export async function deepRefresh(reason = "manual") {
  if (deepRefreshStarted) return;
  deepRefreshStarted = true;

  try {
    sessionStorage.setItem("lastDeepRefreshReason", reason);
    sessionStorage.setItem("lastDeepRefreshAt", String(Date.now()));
  } catch {
    // Ignore storage errors.
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) =>
          registration.update().catch(() => null)
        )
      );

      registrations.forEach((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      });
    }
  } catch {
    // Best-effort only.
  }

  try {
    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch {
    // Best-effort only.
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_deep_refresh", String(Date.now()));
  window.location.replace(url.toString());
}
