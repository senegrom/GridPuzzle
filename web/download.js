// Every Blob the app saves goes through one link. A download prompt (iOS) can
// fetch the object URL well after the click, so an owned URL is revoked a
// minute later, not after a few seconds. A caller that already keeps a URL
// for the same Blob (the saved-picture preview) passes it and keeps ownership.
export const DOWNLOAD_URL_LIFETIME = 60000;

export function downloadBlob(blob, name, url = null) {
  const owned = !url, href = url ?? URL.createObjectURL(blob), link = document.createElement("a");
  link.href = href; link.download = name; link.click();
  if (owned) setTimeout(() => URL.revokeObjectURL(href), DOWNLOAD_URL_LIFETIME);
}
