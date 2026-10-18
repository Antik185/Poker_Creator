'use strict';

const fs = require('fs');
const path = require('path');

const RATE = 44100;
const outDir = path.join(__dirname, '..', 'public', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

let seed = 0x51f15e;
function noise() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff * 2 - 1;
}

function writeWav(name, seconds, sampleAt) {
  const count = Math.floor(RATE * seconds);
  const dataBytes = count * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const sample = Math.max(-1, Math.min(1, sampleAt(t, seconds)));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(outDir, name), buffer);
}

writeWav('rocket-lock.wav', 0.72, (t, duration) => {
  const fade = Math.min(1, t * 18) * Math.min(1, (duration - t) * 14);
  const sweep = 620 + 920 * (t / duration);
  const pulse = Math.pow(Math.max(0, Math.sin(Math.PI * 7 * t)), 9);
  const carrier = Math.sin(Math.PI * 2 * sweep * t) * 0.24;
  const signal = Math.sin(Math.PI * 2 * (sweep * 1.75) * t) * pulse * 0.35;
  return (carrier + signal) * fade;
});

let filteredFlight = 0;
writeWav('rocket-flight.wav', 0.9, (t, duration) => {
  const fade = Math.min(1, t * 13) * Math.min(1, (duration - t) * 10);
  filteredFlight = filteredFlight * 0.88 + noise() * 0.12;
  const engine = Math.sin(Math.PI * 2 * (170 + t * 290) * t) * 0.18;
  const whistle = Math.sin(Math.PI * 2 * (900 + t * 1250) * t) * (0.08 + t * 0.13);
  return (filteredFlight * 0.75 + engine + whistle) * fade;
});

let filteredBlast = 0;
writeWav('rocket-explosion.wav', 0.5, t => {
  const envelope = Math.exp(-t * 10.5);
  filteredBlast = filteredBlast * 0.64 + noise() * 0.36;
  const thump = Math.sin(Math.PI * 2 * (72 - t * 34) * t) * Math.exp(-t * 11.5);
  const crack = noise() * Math.exp(-t * 42);
  return filteredBlast * envelope * 0.58 + thump * 0.68 + crack * 0.32;
});

console.log('Generated rocket-lock.wav, rocket-flight.wav, rocket-explosion.wav');
