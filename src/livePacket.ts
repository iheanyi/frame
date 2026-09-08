export function parseLivePacket(raw: ArrayBuffer) {
  const bytes = new Uint8Array(raw),
    view = new DataView(raw);
  const flags = view.getBigUint64(0);
  const packet =
    flags & (1n << 62n)
      ? { type: "configuration" as const, data: bytes.subarray(12) }
      : {
          type: "data" as const,
          pts: flags & ((1n << 61n) - 1n),
          keyframe: !!(flags & (1n << 61n)),
          data: bytes.subarray(12),
        };
  return packet;
}
