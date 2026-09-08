import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class FileCredentials {
  constructor(directory) { this.directory = directory; }
  async *iterateKeys() {
    try { yield { buffer: new Uint8Array(await readFile(join(this.directory, 'frame-adb.pk8'))), name: 'Frame' }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async generateKey() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537, privateKeyEncoding: { type: 'pkcs8', format: 'der' }, publicKeyEncoding: { type: 'spki', format: 'der' } });
    await writeFile(join(this.directory, 'frame-adb.pk8'), privateKey, { mode: 0o600, flag: 'wx' });
    return { buffer: new Uint8Array(privateKey), name: 'Frame' };
  }
}
