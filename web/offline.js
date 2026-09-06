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
        const ready = await navigator.serviceWorker.ready;
        $("prepare-offline").onclick = async () => {
          const button = $("prepare-offline");
          button.disabled = true;
          try {
            await offlineMessage(ready.active, "PREPARE_OFFLINE");
            $("offline-state").textContent =
              "Offline assets are ready on this device. Browser storage can still be cleared or evicted.";
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
        const offerUpdate = () => {
          if (registration.waiting) {
            $("update-app").hidden = false;
            $("update-app").onclick = () => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => location.reload(),
                { once: true },
              );
              registration.waiting.postMessage({ type: "ACTIVATE" });
            };
          }
        };
        offerUpdate();
        registration.addEventListener("updatefound", () =>
          registration.installing?.addEventListener("statechange", offerUpdate),
        );
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
