export function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("bytesToBase64 expects a Uint8Array.");
  }

  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) {
    throw new TypeError("blobToDataUrl expects a Blob.");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = blob.type || "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
