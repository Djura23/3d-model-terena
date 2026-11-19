// Izvozi demonstracioni projekat kao CSV šablone u folder primeri/ (format identičan uvozu).
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateSampleProject } from '../src/data/sample.js';
import { exportCSVs } from '../src/data/io.js';

const p = generateSampleProject();
mkdirSync('primeri', { recursive: true });
for (const [name, text] of Object.entries(exportCSVs(p))) {
  writeFileSync(`primeri/${name}`, '﻿' + text, 'utf8');
  console.log('primeri/' + name, text.split('\n').length - 2, 'redova');
}
