import fs from 'fs';
const code = fs.readFileSync('apps/desktop-live2d/shared/pixi_cubism_backend.mjs', 'utf8');
let d = 0;
let lineDist = {};
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '{') d++;
    if (line[j] === '}') d--;
  }
  lineDist[i] = d;
}
console.log('Final depth:', d);
