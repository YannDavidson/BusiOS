const BIAS = 0x84;

export function mulaw8kToPcm16k(payload: Buffer): Buffer {
  const output = Buffer.alloc(payload.length * 4);
  for (let i = 0; i < payload.length; i++) {
    const sample = decodeMulaw(payload[i] ?? 0);
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(sample, i * 4 + 2);
  }
  return output;
}

export function pcm24kToMulaw8k(payload: Buffer): Buffer {
  const samples = Math.floor(payload.length / 2);
  const output = Buffer.alloc(Math.ceil(samples / 3));
  let target = 0;
  for (let source = 0; source < samples; source += 3) output[target++] = encodeMulaw(payload.readInt16LE(source * 2));
  return output.subarray(0, target);
}

function decodeMulaw(value: number) {
  const mu = (~value) & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  const sample = ((mantissa << 3) + BIAS) << exponent;
  return clamp16(sign ? BIAS - sample : sample - BIAS);
}

function encodeMulaw(input: number) {
  let sample = clamp16(input);
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(32635, sample) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(sample & mask); exponent--, mask >>= 1) { /* find segment */ }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function clamp16(value: number) { return Math.max(-32768, Math.min(32767, value)); }
