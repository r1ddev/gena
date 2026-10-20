export const maximumImportFileBytes = 20 * 1024 * 1024;
export const maximumImportRequestBytes = maximumImportFileBytes + 64 * 1024;
export const maximumImportExpandedBytes = 100 * 1024 * 1024;
export const maximumImportRows = 30_000;

export async function readRequestBodyWithinLimit(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("Размер запроса превышает установленный лимит.");
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("Размер запроса превышает установленный лимит.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export function assertXlsxExpandedSize(buffer: Buffer, maximumBytes = maximumImportExpandedBytes) {
  if (buffer.length < 22) throw new Error("Файл .xlsx повреждён или не является архивом ZIP.");
  const signature = 0x06054b50;
  const lowerBound = Math.max(0, buffer.length - 22 - 0xffff);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== signature) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength <= buffer.length) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new Error("Файл .xlsx повреждён или не является архивом ZIP.");

  const disk = buffer.readUInt16LE(endRecord + 4);
  const directoryDisk = buffer.readUInt16LE(endRecord + 6);
  const entriesOnDisk = buffer.readUInt16LE(endRecord + 8);
  const entryCount = buffer.readUInt16LE(endRecord + 10);
  const directorySize = buffer.readUInt32LE(endRecord + 12);
  const directoryOffset = buffer.readUInt32LE(endRecord + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("Файл .xlsx использует неподдерживаемый формат архива.");
  }
  if (directoryOffset + directorySize > endRecord) throw new Error("Файл .xlsx повреждён или не является архивом ZIP.");

  let expandedBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Файл .xlsx повреждён или не является архивом ZIP.");
    }
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || buffer.readUInt16LE(offset + 34) !== 0) {
      throw new Error("Файл .xlsx использует неподдерживаемый формат архива.");
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > maximumBytes) throw new Error("Размер распакованных данных .xlsx превышает безопасный лимит 100 МБ.");
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  if (offset > directoryOffset + directorySize) throw new Error("Файл .xlsx повреждён или не является архивом ZIP.");
  return expandedBytes;
}
