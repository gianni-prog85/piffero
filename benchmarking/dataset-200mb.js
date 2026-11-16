/**
 * Shared generator/cache for the 200 MiB benchmark dataset in os.tmpdir().
 * Built deterministically from spec/jsonFiles/large-file.json (~39.2 MB).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC_FILE = path.join(__dirname, "../spec/jsonFiles/large-file.json");
const OUT_FILE = path.join(os.tmpdir(), "piffero-large-200mb.json");
const META_FILE = path.join(os.tmpdir(), "piffero-large-200mb.meta.json");
const TARGET_BYTES = 200 * 1024 * 1024; // 200 MiB (~209.72 MB)

function ensure200MbDataset() {
  if (fs.existsSync(OUT_FILE) && fs.existsSync(META_FILE)) {
    const stat = fs.statSync(OUT_FILE);
    try {
      const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
      if (stat.size === meta.bytesWritten && stat.size >= TARGET_BYTES) {
        return { filePath: OUT_FILE, ...meta };
      }
    } catch {
      // Regenerate below if metadata is unreadable
    }
  }

  const srcRaw = fs.readFileSync(SRC_FILE, "utf8").trim();
  const srcData = JSON.parse(srcRaw);
  const srcLen = srcData.length;
  const inner = srcRaw.slice(1, -1).trim();

  const fd = fs.openSync(OUT_FILE, "w");
  fs.writeSync(fd, "[");
  let bytesWritten = 1;
  let totalElements = 0;
  let firstChunk = true;

  while (bytesWritten + inner.length + 2 <= TARGET_BYTES) {
    if (!firstChunk) {
      fs.writeSync(fd, ",");
      bytesWritten += 1;
    }
    fs.writeSync(fd, inner);
    bytesWritten += inner.length;
    totalElements += srcLen;
    firstChunk = false;
  }

  let idx = 0;
  while (bytesWritten < TARGET_BYTES) {
    const serialized = JSON.stringify(srcData[idx % srcLen]);
    fs.writeSync(fd, "," + serialized);
    bytesWritten += 1 + serialized.length;
    totalElements += 1;
    idx++;
  }

  fs.writeSync(fd, "]");
  bytesWritten += 1;
  fs.closeSync(fd);

  const meta = {
    bytesWritten,
    totalElements,
    midIdx: Math.floor(totalElements / 2),
    endIdx: 4 * srcLen + (srcLen - 1),
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta));
  return { filePath: OUT_FILE, ...meta };
}

module.exports = { ensure200MbDataset, TARGET_BYTES };
