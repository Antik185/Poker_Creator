'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'public', 'sounds', 'allin_user_loop_fixed.wav');
const outputPath = path.join(__dirname, '..', 'public', 'sounds', 'allin_user_loop_mobile.wav');
const source = fs.readFileSync(sourcePath);

if (source.toString('ascii', 0, 4) !== 'RIFF' || source.toString('ascii', 8, 12) !== 'WAVE') {
  throw new Error('Expected a RIFF/WAVE source');
}

let format = null;
let dataOffset = -1;
let dataSize = 0;
for (let offset = 12; offset + 8 <= source.length;) {
  const chunkId = source.toString('ascii', offset, offset + 4);
  const chunkSize = source.readUInt32LE(offset + 4);
  const payloadOffset = offset + 8;
  if (chunkId === 'fmt ') {
    format = {
      audioFormat: source.readUInt16LE(payloadOffset),
      channels: source.readUInt16LE(payloadOffset + 2),
      sampleRate: source.readUInt32LE(payloadOffset + 4),
      bitsPerSample: source.readUInt16LE(payloadOffset + 14)
    };
  } else if (chunkId === 'data') {
    dataOffset = payloadOffset;
    dataSize = Math.min(chunkSize, source.length - payloadOffset);
    break;
  }
  offset = payloadOffset + chunkSize + (chunkSize % 2);
}

if (!format || dataOffset < 0) throw new Error('Missing WAV format or data chunk');
if (format.audioFormat !== 1 || format.channels !== 2 || format.bitsPerSample !== 24) {
  throw new Error(`Unsupported source format: ${JSON.stringify(format)}`);
}

const targetRate = 24000;
const downsample = format.sampleRate / targetRate;
if (!Number.isInteger(downsample) || downsample < 1) {
  throw new Error(`Source sample rate ${format.sampleRate} cannot be reduced to ${targetRate}`);
}

const inputFrameBytes = format.channels * 3;
const inputFrames = Math.floor(dataSize / inputFrameBytes);
const outputFrames = Math.floor(inputFrames / downsample);
const pcm = Buffer.allocUnsafe(outputFrames * 2);

for (let outputFrame = 0; outputFrame < outputFrames; outputFrame++) {
  let sum = 0;
  for (let sampleFrame = 0; sampleFrame < downsample; sampleFrame++) {
    const frameOffset = dataOffset + ((outputFrame * downsample + sampleFrame) * inputFrameBytes);
    sum += source.readIntLE(frameOffset, 3);
    sum += source.readIntLE(frameOffset + 3, 3);
  }
  const averaged24Bit = sum / (downsample * format.channels);
  const sample16Bit = Math.max(-32768, Math.min(32767, Math.round(averaged24Bit / 256)));
  pcm.writeInt16LE(sample16Bit, outputFrame * 2);
}

const output = Buffer.allocUnsafe(44 + pcm.length);
output.write('RIFF', 0, 'ascii');
output.writeUInt32LE(36 + pcm.length, 4);
output.write('WAVE', 8, 'ascii');
output.write('fmt ', 12, 'ascii');
output.writeUInt32LE(16, 16);
output.writeUInt16LE(1, 20);
output.writeUInt16LE(1, 22);
output.writeUInt32LE(targetRate, 24);
output.writeUInt32LE(targetRate * 2, 28);
output.writeUInt16LE(2, 32);
output.writeUInt16LE(16, 34);
output.write('data', 36, 'ascii');
output.writeUInt32LE(pcm.length, 40);
pcm.copy(output, 44);
fs.writeFileSync(outputPath, output);

console.log(`Generated ${path.basename(outputPath)}: ${output.length} bytes, ${outputFrames / targetRate}s`);
