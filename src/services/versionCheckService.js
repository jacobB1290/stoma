import { APP_VERSION, compareVersions } from "../version";

const POLL_INTERVAL = 60 * 1000;
const LAST_NOTIFIED_KEY = "lastNotifiedVersion";

function mapPriority(priority) {
  if (priority === "urgent" || priority === "high") return "high";
  if (priority === "force") return "force";
  return "normal";
}

async function fetchReleaseMetadata() {
  const response = await fetch(`/version.json?ts=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Version metadata request failed: ${response.status}`);
  }

  return response.json();
}

export function startVersionPolling() {
  let canceled = false;

  const checkForUpdates = async () => {
    try {
      const metadata = await fetchReleaseMetadata();
      if (canceled || !metadata?.version) return;

      const isNewer = compareVersions(metadata.version, APP_VERSION) > 0;
      if (!isNewer) return;

      const alreadyNotified =
        localStorage.getItem(LAST_NOTIFIED_KEY) === metadata.version;
      if (alreadyNotified) return;

      const notes = typeof metadata.changes === "string" ? metadata.changes : "";
      const priority = mapPriority(metadata.priority);

      localStorage.setItem("updateNotes", notes);
      localStorage.setItem("updatePriority", priority);
      localStorage.setItem(LAST_NOTIFIED_KEY, metadata.version);

      window.dispatchEvent(
        new CustomEvent("update-available", {
          detail: {
            priority,
            notes,
            version: metadata.version,
            date: metadata.date || "",
            timestamp: Date.now(),
          },
        })
      );
    } catch (error) {
      // Silent failure: polling should never break app UX.
      console.debug("Version check failed:", error?.message || error);
    }
  };

  checkForUpdates();
  const intervalId = window.setInterval(checkForUpdates, POLL_INTERVAL);

  return () => {
    canceled = true;
    window.clearInterval(intervalId);
  };
}
