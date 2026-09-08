/** Record and monitor are independent branches. Never monitor the microphone. */
export function createAudioRouting(context: AudioContext) {
  const destination = context.createMediaStreamDestination();
  const input = context.createGain();
  const device = context.createGain();
  const microphone = context.createGain();
  const monitor = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  input.connect(device);
  device.connect(destination);
  input.connect(monitor);
  monitor.connect(context.destination);
  input.connect(analyser);
  microphone.connect(destination);
  monitor.gain.value = 0;
  return {
    input, device, microphone, destination,
    setMonitoring(enabled: boolean) {
      monitor.gain.setTargetAtTime(enabled ? 1 : 0, context.currentTime, 0.02);
    },
    level() {
      if (context.state !== 'running') return 0;
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(peak, 0.001)) + 60) / 60));
    },
  };
}
