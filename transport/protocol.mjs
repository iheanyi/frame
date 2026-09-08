export function parseRequest(line) {
  const value = JSON.parse(line);
  if (!value || !['string', 'number'].includes(typeof value.id) || typeof value.method !== 'string' || (value.params !== undefined && (!value.params || typeof value.params !== 'object' || Array.isArray(value.params)))) throw new Error('Expected {id, method, params?}');
  return { ...value, params: value.params ?? {} };
}

export function packetJson(packet) {
  return { type: packet.type, data: Buffer.from(packet.data).toString('base64'), ...(packet.type === 'data' ? { pts: String(packet.pts), keyframe: Boolean(packet.keyframe) } : {}) };
}

export function requireString(value, name) {
  if (typeof value !== 'string' || !value.length) throw new Error(`${name} is required`);
  return value;
}
