const CRC32_TABLE = createCrc32Table();
const ZIP_UTF8_FLAG = 0x0800;

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }

    table[index] = value >>> 0;
  }

  return table;
}

function computeCrc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const safeYear = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((safeYear - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return {
    time: dosTime & 0xffff,
    date: dosDate & 0xffff
  };
}

function createLocalFileHeader(entry) {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(entry.nameBytes, 30);

  return header;
}

function createCentralDirectoryHeader(entry) {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  header.set(entry.nameBytes, 46);

  return header;
}

function createEndOfCentralDirectory(recordCount, directorySize, directoryOffset) {
  const trailer = new Uint8Array(22);
  const view = new DataView(trailer.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, recordCount, true);
  view.setUint16(10, recordCount, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, directoryOffset, true);
  view.setUint16(20, 0, true);

  return trailer;
}

export function createStoredZip(textFiles) {
  if (!Array.isArray(textFiles) || textFiles.length === 0) {
    throw new Error("No files to zip.");
  }

  const encoder = new TextEncoder();
  const preparedEntries = textFiles.map((file) => {
    const name = typeof file?.name === "string" ? file.name : "";
    const content = typeof file?.content === "string" ? file.content : "";

    if (!name) {
      throw new Error("ZIP entry name is required.");
    }

    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const { time, date } = getDosDateTime();

    return {
      nameBytes,
      dataBytes,
      size: dataBytes.length,
      crc32: computeCrc32(dataBytes),
      dosTime: time,
      dosDate: date,
      localHeaderOffset: 0
    };
  });

  const localParts = [];
  let offset = 0;

  for (const entry of preparedEntries) {
    entry.localHeaderOffset = offset;
    const header = createLocalFileHeader(entry);
    localParts.push(header, entry.dataBytes);
    offset += header.length + entry.dataBytes.length;
  }

  const centralDirectoryParts = [];
  let centralDirectorySize = 0;

  for (const entry of preparedEntries) {
    const header = createCentralDirectoryHeader(entry);
    centralDirectoryParts.push(header);
    centralDirectorySize += header.length;
  }

  const directoryOffset = offset;
  const endRecord = createEndOfCentralDirectory(
    preparedEntries.length,
    centralDirectorySize,
    directoryOffset
  );

  return new Blob(
    [...localParts, ...centralDirectoryParts, endRecord],
    { type: "application/zip" }
  );
}
