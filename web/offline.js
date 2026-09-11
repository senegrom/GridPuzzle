export function setupOffline($) {
  let generation = 0, pending = null;
  function supersedeOffline() {
    generation++;
    pending?.abort();
    pending = null;
    return generation;
  }
  function offlineMessage(worker, type, onProgress = () => {}) {
    const controller = new AbortController();
    pending = controller;
    return new Promise((resolve, reject) => {
      let channel = null, timeout = null, settled = false;
      const settle = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", cancel);
        if (pending === controller) pending = null;
        if (channel) {
          channel.port1.onmessage = channel.port1.onmessageerror = null;
          channel.port1.close();
          // On a failed post this port was never transferred. After transfer,
          // closing the detached local endpoint is harmless.
          channel.port2.close?.();
        }
        if (error) reject(error);
        else resolve(message);
      };
      const cancel = () => settle(new DOMException("Offline request superseded", "AbortError"));
      try {
        channel = new MessageChannel();
        controller.signal.addEventListener("abort", cancel, { once: true });
        timeout = setTimeout(() => settle(
          Error("Offline preparation did not finish. Go online and retry."),
        ), 300000);
        channel.port1.onmessage = ({ data: m }) => {
          if (settled) return;
          if (!m || typeof m !== "object") {
            settle(Error("Invalid offline worker response. Retry."));
            return;
          }
          if (m.done || m.error) {
            settle(m.error ? Error(m.error) : null, m);
          } else if (m.progress !== undefined) onProgress(m);
        };
        channel.port1.onmessageerror = () => settle(
          Error("Could not read the offline worker response. Retry."),
        );
        worker.postMessage({ type }, [channel.port2]);
      } catch (error) {
        settle(error);
      }
    });
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then(async (registration) => {
        // The button inside the collapsed offline section is easy to miss,
        // so a banner at the top of the page mirrors it: a phone that never
        // updates keeps every old recognition bug.
        const updateButton = $("update-app"),
          banner = $("update-banner"),
          bannerButton = $("update-banner-button");
        let controller = navigator.serviceWorker.controller,
          needsReload = false,
          reloadRequested = false;
        const offerUpdate = () => {
          const available = Boolean(registration.waiting) || needsReload;
          updateButton.hidden = !available;
          banner.hidden = !available;
          updateButton.textContent = registration.waiting
            ? "Update app & reload"
            : "Reload updated app";
          bannerButton.textContent = updateButton.textContent;
        };
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          const next = navigator.serviceWorker.controller;
          if (controller && next !== controller) {
            needsReload = true;
            supersedeOffline();
            $("prepare-offline").disabled = false;
            $("offline-state").textContent =
              "App updated. Reload the updated app before preparing offline use.";
          }
          controller = next;
          if (reloadRequested) location.reload();
          else offerUpdate();
        });
        updateButton.onclick = bannerButton.onclick = () => {
          // Another tab may already have activated the waiting worker. Keep
          // this tab's work until its user chooses to reload the updated app.
          const waiting = registration.waiting;
          if (!waiting) {
            location.reload();
            return;
          }
          supersedeOffline();
          reloadRequested = true;
          updateButton.disabled = bannerButton.disabled = true;
          try {
            waiting.postMessage({ type: "ACTIVATE" });
          } catch (error) {
            reloadRequested = false;
            updateButton.disabled = bannerButton.disabled = false;
            $("prepare-offline").disabled = false;
            $("offline-state").textContent = error.message || String(error);
            offerUpdate();
          }
        };
        offerUpdate();
        registration.addEventListener("updatefound", () =>
          registration.installing?.addEventListener("statechange", offerUpdate),
        );
        const ready = await navigator.serviceWorker.ready;
        $("prepare-offline").disabled = false;
        $("prepare-offline").onclick = async () => {
          // A retained old document must not certify a different build's cache.
          // Updating in another tab never reloads this tab without its consent.
          if (needsReload) {
            $("offline-state").textContent =
              "Reload the updated app before preparing offline use.";
            return;
          }
          const button = $("prepare-offline"), id = supersedeOffline(), worker = ready.active;
          const current = () => id === generation && worker === ready.active;
          button.disabled = true;
          try {
            const result = await offlineMessage(worker, "PREPARE_OFFLINE", (m) => {
              if (current()) $("offline-state").textContent =
                `Downloading offline assets: ${m.progress} / ${m.total}`;
            });
            if (!current()) return;
            if (result.ready !== true)
              throw Error("Offline verification did not complete. Go online and retry.");
            let persistent = false;
            try {
              persistent = Boolean(await navigator.storage?.persist?.());
            } catch {
              /* Persistence is a request, never a requirement. */
            }
            if (!current()) return;
            $("offline-state").textContent = persistent
              ? "Offline assets are ready on this device, and the browser granted persistent storage."
              : "Offline assets are ready on this device. Browser storage can still be cleared or evicted.";
          } catch (e) {
            if (current()) $("offline-state").textContent = e.message;
          } finally {
            if (id === generation) button.disabled = false;
          }
        };
        if (!needsReload) {
          const id = supersedeOffline(), worker = ready.active;
          offlineMessage(worker, "OFFLINE_STATUS")
            .then((m) => {
              // A cheap startup presence check cannot override a newer full
              // verification result, progress message or validation failure.
              if (id === generation && worker === ready.active && m.ready === true)
                $("offline-state").textContent =
                  "Offline assets are ready on this device.";
            })
            .catch(() => {});
        }
      })
      .catch((e) => {
        $("prepare-offline").disabled = true;
        $("offline-state").textContent =
          `Offline caching unavailable: ${e.message}`;
      });
  } else {
    $("prepare-offline").disabled = true;
    $("offline-state").textContent =
      "This browser does not support offline caching.";
  }
}
