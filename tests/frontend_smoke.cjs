const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
const functions = src.split("\nfor(const btn of document.querySelectorAll('.tab'))")[0];
const context = vm.createContext({ Blob, ArrayBuffer, DataView, Uint8Array, String, Math, console });
vm.runInContext(functions, context);
const events = vm.runInContext(`planNarration('First paragraph.\\n\\nSecond sentence. [pause=1.5] Last sentence.', 440, .4)`,context);
assert.deepStrictEqual(Array.from(events, e=>e.type), ['speech','pause','speech','pause','speech']);
assert.equal(events[1].secs,0.4);
assert.equal(events[3].secs,1.5);
const chunks=vm.runInContext(`splitByLimit('hello '.repeat(200), 100)`,context);
assert(chunks.every(c=>c.length<=100));
// Validate cross-segment file assembly, independent of Sarvam network availability.
function wav(samples=2400) {
 const bytes=Buffer.alloc(44+samples*2);const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 bytes.write('RIFF',0);dv.setUint32(4,bytes.length-8,true);bytes.write('WAVE',8);bytes.write('fmt ',12);dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,24000,true);dv.setUint32(28,48000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);bytes.write('data',36);dv.setUint32(40,samples*2,true);
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}
context.clip1=wav();context.clip2=wav();
vm.runInContext('var combined=joinWav([clip1,clip2],[{type:"speech"},{type:"pause",secs:.5},{type:"speech"}]);',context);
assert(Math.abs(context.combined.duration - .7)<.001);
assert.equal(context.combined.blob.type,'audio/wav');
console.log('Frontend smoke tests passed: chunking, pauses, WAV assembly.');
