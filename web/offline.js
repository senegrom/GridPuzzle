export function setupOffline($) {
  function offlineMessage(worker, type) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(
          Error("Offline preparation did not finish. Go online and retry."),
        );
      }, 300000);
      channel.port1.onmessage = ({ data: m }) => {
        if (m.progress !== undefined)
          $("offline-state").textContent =
            `Downloading offline assets: ${m.progress} / ${m.total}`;
        if (m.done || m.error) {
          clearTimeout(timeout);
          channel.port1.close();
          m.error ? reject(Error(m.error)) : resolve(m);
        }
      };
      worker.postMessage({ type }, [channel.port2]);
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
          if (controller && next !== controller) needsReload = true;
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
          reloadRequested = true;
          updateButton.disabled = bannerButton.disabled = true;
          waiting.postMessage({ type: "ACTIVATE" });
        };
        offerUpdate();
        registration.addEventListener("updatefound", () =>
          registration.installing?.addEventListener("statechange", offerUpdate),
        );
        const ready = await navigator.serviceWorker.ready;
        $("prepare-offline").disabled = false;
        $("prepare-offline").onclick = async () => {
          const button = $("prepare-offline");
          button.disabled = true;
          try {
            await offlineMessage(ready.active, "PREPARE_OFFLINE");
            let persistent = false;
            try {
              persistent = Boolean(await navigator.storage?.persist?.());
            } catch {
              /* Persistence is a request, never a requirement. */
            }
            $("offline-state").textContent = persistent
              ? "Offline assets are ready on this device, and the browser granted persistent storage."
              : "Offline assets are ready on this device. Browser storage can still be cleared or evicted.";
          } catch (e) {
            $("offline-state").textContent = e.message;
          } finally {
            button.disabled = false;
          }
        };
        offlineMessage(ready.active, "OFFLINE_STATUS")
          .then((m) => {
            if (m.ready)
              $("offline-state").textContent =
                "Offline assets are ready on this device.";
          })
          .catch(() => {});
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
