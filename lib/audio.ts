export type AudioDetails = { duration: number; sampleRate: number; peak: number; rms: number };

/** Encode actual PCM samples, rather than relabelling compressed WebM as WAV. */
export function encodeMonoWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!samples.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error("Invalid PCM audio.");
  const output = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(output);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, output.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return output;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (!channels.length || !channels[0].length || channels.some((channel) => channel.length !== channels[0].length)) throw new Error("No complete audio samples.");
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  return mono;
}

export function describeAudio(samples: Float32Array, sampleRate: number): AudioDetails {
  let peak = 0;
  let squared = 0;
  for (const sample of samples) { peak = Math.max(peak, Math.abs(sample)); squared += sample * sample; }
  return { duration: samples.length / sampleRate, sampleRate, peak, rms: samples.length ? Math.sqrt(squared / samples.length) : 0 };
}

// decodeAudioData waits for a complete recording and resamples it to the
// context's 16 kHz rate. This runs locally; only the resulting WAV is uploaded.
export async function prepareRecording(recording: Blob): Promise<{ audio: Blob; details: AudioDetails }> {
  const decoder = new OfflineAudioContext(1, 1, 16000);
  let decoded: AudioBuffer;
  try { decoded = await decoder.decodeAudioData(await recording.arrayBuffer()); }
  catch { throw new Error("రికార్డింగ్ ఫైల్ తెరవలేకపోయాము. The browser could not read the completed recording. Record a new clip and let it finish processing."); }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
  const mono = mixToMono(channels);
  const details = describeAudio(mono, decoded.sampleRate);
  if (details.duration < 0.25) throw new Error("రికార్డింగ్ చాలా చిన్నది. Record for at least one second before stopping.");
  if (details.duration > 29) throw new Error("రికార్డింగ్ సమయం ఎక్కువైంది. Record a new clip under 20 seconds.");
  return { audio: new Blob([encodeMonoWav(mono, decoded.sampleRate)], { type: "audio/wav" }), details };
}
