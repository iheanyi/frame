import { openSync, writeSync, closeSync, statSync } from 'node:fs';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { h264ParseConfiguration } from '@yume-chan/scrcpy';

// Android emits Annex B; MP4 stores length-prefixed NAL units and avcC metadata.
export function splitAnnexB(bytes) {
  const starts = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) { starts.push({ start: i, data: i + 3 }); i += 2; }
    else if (i + 3 < bytes.length && bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) { starts.push({ start: i, data: i + 4 }); i += 3; }
  }
  if (!starts.length) throw new Error('Expected Annex B H.264 data');
  return starts.map((item, index) => bytes.subarray(item.data, starts[index + 1]?.start ?? bytes.length)).filter(nalu => nalu.length);
}
export function annexBToAvcc(bytes) {
  const nalus = splitAnnexB(bytes);
  const result = new Uint8Array(nalus.reduce((size, nalu) => size + 4 + nalu.length, 0));
  const view = new DataView(result.buffer); let offset = 0;
  for (const nalu of nalus) { view.setUint32(offset, nalu.length); result.set(nalu, offset + 4); offset += 4 + nalu.length; }
  return result;
}
export function avcDescription(configuration) {
  const { sequenceParameterSet: sps, pictureParameterSet: pps, profileIndex, constraintSet, levelIndex } = configuration;
  return Uint8Array.from([1, profileIndex, constraintSet, levelIndex, 255, 225, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps]);
}
export function parseAacConfiguration(bytes) {
  if (bytes.length < 2) throw new Error('Missing AAC AudioSpecificConfig');
  const objectType = bytes[0] >> 3;
  const rateIndex = ((bytes[0] & 7) << 1) | (bytes[1] >> 7);
  const sampleRate = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][rateIndex];
  const numberOfChannels = (bytes[1] >> 3) & 15;
  if (objectType !== 2 || !sampleRate || numberOfChannels < 1 || numberOfChannels > 2) throw new Error('Only AAC-LC mono/stereo capture is supported');
  return { sampleRate, numberOfChannels, codec: 'mp4a.40.2', description: bytes };
}

export class NativeMp4Recorder {
  constructor(outputPath, withAudio, fps = 60) {
    this.outputPath = outputPath; this.withAudio = withAudio; this.fps = fps;
    // Never overwrite an existing original.
    this.fd = openSync(outputPath, 'wx', 0o600);
    this.pending = []; this.pendingBytes = 0; this.videoFrames = 0; this.audioFrames = 0;
    this.firstPts = Infinity; this.lastPts = 0; this.finished = false;
  }
  configureVideo(bytes) {
    const configuration = h264ParseConfiguration(bytes);
    if (this.videoConfig && (configuration.croppedWidth !== this.videoConfig.croppedWidth || configuration.croppedHeight !== this.videoConfig.croppedHeight)) throw new Error('Phone rotated during recording. Stop and begin a new take for the new orientation.');
    this.videoConfig = configuration; this.videoDescription = avcDescription(configuration); this.initialize();
  }
  configureAudio(bytes) { this.audioConfig = parseAacConfiguration(bytes); this.initialize(); }
  initialize() {
    if (this.muxer || !this.videoConfig || (this.withAudio && !this.audioConfig)) return;
    const c = this.videoConfig;
    this.muxer = new Muxer({
      target: new StreamTarget({ chunked: true, chunkSize: 1024 * 1024, onData: (data, position) => { let written = 0; while (written < data.length) written += writeSync(this.fd, data, written, data.length - written, position + written); } }),
      video: { codec: 'avc', width: c.croppedWidth, height: c.croppedHeight },
      ...(this.withAudio ? { audio: { codec: 'aac', sampleRate: this.audioConfig.sampleRate, numberOfChannels: this.audioConfig.numberOfChannels } } : {}),
      fastStart: 'fragmented', firstTimestampBehavior: 'cross-track-offset',
    });
    this.drainInitialPackets();
  }
  drainInitialPackets() {
    if (!this.muxer || !this.pending.some(item => item.type === 'video' && item.packet.keyframe) || (this.withAudio && !this.pending.some(item => item.type === 'audio'))) return;
    this.started = true;
    const pending = this.pending.sort((a,b) => Number(a.packet.pts - b.packet.pts)); this.pending = []; this.pendingBytes = 0;
    this.initialVideoLeads = pending[0].type === 'video'; this.initialAudio = [];
    for (const { type, packet } of pending) this.add(type, packet);
  }
  add(type, packet) {
    if (this.finished) throw new Error('Recording already finalized');
    if (packet.type === 'configuration') { if (type === 'video') this.configureVideo(packet.data); else this.configureAudio(packet.data); return; }
    if (!this.muxer || !this.started) {
      this.pendingBytes += packet.data.length;
      if (this.pendingBytes > 64 * 1024 * 1024) throw new Error('Codec configuration missing; capture cannot be saved');
      this.pending.push({ type, packet }); this.drainInitialPackets(); return;
    }
    const pts = Number(packet.pts);
    if (!Number.isSafeInteger(pts) || pts < 0) throw new Error('Invalid capture timestamp');
    this.firstPts = Math.min(this.firstPts, pts); this.lastPts = Math.max(this.lastPts, pts);
    if (type === 'video') {
      if (!this.videoFrames && !packet.keyframe) return;
      if (this.previousVideo) {
        if (pts <= this.previousVideo.pts) throw new Error('Non-monotonic video timestamp');
        this.flushVideo(pts - this.previousVideo.pts);
      }
      this.previousVideo = { packet, pts }; this.videoFrames++;
    } else {
      if (this.initialVideoLeads && !this.videoWritten) { this.initialAudio.push(packet); return; }
      this.muxer.addAudioChunkRaw(packet.data, 'key', pts, 1024 / this.audioConfig.sampleRate * 1e6, { decoderConfig: this.audioConfig });
      this.audioFrames++;
    }
  }
  flushVideo(duration) {
    const { packet, pts } = this.previousVideo;
    const c = this.videoConfig;
    this.muxer.addVideoChunkRaw(annexBToAvcc(packet.data), packet.keyframe ? 'key' : 'delta', pts, duration, { decoderConfig: { codec: `avc1.${[c.profileIndex,c.constraintSet,c.levelIndex].map(n => n.toString(16).padStart(2,'0')).join('')}`, codedWidth: c.croppedWidth, codedHeight: c.croppedHeight, description: this.videoDescription } });
    this.videoWritten = true;
    for (const audio of this.initialAudio.splice(0)) {
      this.muxer.addAudioChunkRaw(audio.data, 'key', Number(audio.pts), 1024 / this.audioConfig.sampleRate * 1e6, { decoderConfig: this.audioConfig }); this.audioFrames++;
    }
  }
  finalize() {
    if (this.finished) throw new Error('Recording already finalized');
    this.finished = true;
    try {
      if (!this.muxer || !this.videoFrames) throw new Error('No video frames captured');
      this.flushVideo(1e6 / this.fps);
      if (this.withAudio && !this.audioFrames) throw new Error('No audio frames captured');
      this.muxer.finalize();
      return { outputPath: this.outputPath, width: this.videoConfig.croppedWidth, height: this.videoConfig.croppedHeight, duration: (this.lastPts - this.firstPts) / 1e6 + 1 / this.fps, bytes: statSync(this.outputPath).size };
    } finally { closeSync(this.fd); }
  }
  abort() { if (!this.finished) { this.finished = true; closeSync(this.fd); } }
}
