#!/usr/bin/env node
// Generates web/src/anatomy/body.svg: original schematic body diagrams (CC0 1.0) in four views.
// Every highlightable element carries data-t="tag tag ..."; the app highlights by tag.
// Run: node tools/anatomy/gen-body.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/src/anatomy/body.svg');
const W = 220;
const f = (n) => Math.round(n * 10) / 10;
const mir = (pts) => pts.map(([x, y]) => [W - x, y]);

// closed Catmull-Rom spline through points -> cubic Bezier path
function blob(pts, k = 1) {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * k, p1[1] + ((p2[1] - p0[1]) / 6) * k];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * k, p2[1] - ((p3[1] - p1[1]) / 6) * k];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}
const line = (pts) => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L');
const curve = (pts) => {
  // open Catmull-Rom
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
};
const el = (tag, attrs) => `<${tag} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
const path = (d, cls, tags) => el('path', { d, class: cls, 'data-t': tags });
const ell = (cx, cy, rx, ry, cls, tags, rot) => el('ellipse', { cx, cy, rx, ry, class: cls, 'data-t': tags, transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined });
const both = (pts, cls, tags) => [path(blob(pts), cls, tags), path(blob(mir(pts)), cls, tags)];

// ---- geometry (patient's right is the viewer's left) ----
const G = {
  chest: [[70, 92], [110, 86], [150, 92], [148, 130], [146, 162], [110, 166], [74, 162], [72, 130]],
  abdomen: [[76, 164], [110, 168], [144, 164], [142, 196], [140, 222], [110, 228], [80, 222], [78, 196]],
  pelvis: [[80, 224], [110, 230], [140, 224], [150, 252], [140, 278], [110, 270], [80, 278], [70, 252]],
  neck: [[100, 62], [120, 62], [122, 88], [98, 88]],
  arm: [[44, 106], [68, 108], [62, 176], [38, 174]],
  forearm: [[38, 178], [62, 180], [54, 240], [32, 236]],
  hand: [[32, 238], [52, 242], [50, 272], [36, 276], [30, 260]],
  thigh: [[78, 272], [108, 274], [104, 360], [80, 358]],
  leg: [[80, 378], [104, 378], [100, 452], [84, 452]],
  foot: [[80, 454], [102, 454], [106, 472], [72, 474]],
};
const shoulderL = [60, 98, 17, 13];

function bodyShapes(view) {
  const skin = view === 'surface' || view === 'back';
  const cls = skin ? 'part' : 'ghost';
  const t = (tags) => (skin ? `${tags} skin` : undefined);
  const parts = [];
  parts.push(ell(110, 36, 25, 31, cls, t(view === 'surface' ? 'head face' : 'head')));
  parts.push(path(blob(G.neck), cls, t('neck')));
  for (const sx of [1, -1]) parts.push(ell(sx > 0 ? 60 : W - 60, 98, 17, 13, cls, t('shoulder')));
  parts.push(path(blob(G.chest), cls, t(view === 'back' ? 'back' : 'chest')));
  parts.push(path(blob(G.abdomen), cls, t(view === 'back' ? 'lumbar' : 'abdomen')));
  if (view === 'back') {
    parts.push(ell(94, 252, 24, 26, cls, t('buttock')), ell(W - 94, 252, 24, 26, cls, t('buttock')));
  } else parts.push(path(blob(G.pelvis), cls, t('pelvis')));
  parts.push(...both(G.arm, cls, t('arm')), ...both(G.forearm, cls, t('forearm')), ...both(G.hand, cls, t('hand')));
  parts.push(...both(G.thigh, cls, t('thigh')));
  parts.push(ell(92, 368, 13, 10, cls, t('knee')), ell(W - 92, 368, 13, 10, cls, t('knee')));
  parts.push(...both(G.leg, cls, t('leg')), ...both(G.foot, cls, t('foot')));
  return parts;
}

function surface() {
  const s = bodyShapes('surface');
  s.push(ell(99, 34, 4, 2.6, 'feature', 'eye face'), ell(121, 34, 4, 2.6, 'feature', 'eye face'));
  s.push(ell(84, 40, 4, 8, 'part', 'ear head skin'), ell(136, 40, 4, 8, 'part', 'ear head skin'));
  s.push(path('M110 38 L105 53 L115 53Z', 'feature', 'nose face'), ell(110, 63, 8, 3, 'feature', 'mouth face'));
  s.push(ell(90, 118, 9, 9, 'part', 'breast chest skin'), ell(130, 118, 9, 9, 'part', 'breast chest skin'));
  s.push(ell(110, 190, 2, 2, 'feature', undefined));
  return s;
}

function back() {
  const s = bodyShapes('back');
  s.push(path(line([[110, 64], [110, 226]]), 'ghost', undefined));
  return s;
}

function organs() {
  const s = bodyShapes('organs');
  // brain
  s.push(path(blob([[92, 28], [100, 15], [120, 15], [128, 28], [124, 42], [110, 47], [96, 42]]), 'organ', 'brain nervous'));
  s.push(path(curve([[100, 26], [108, 22], [114, 30], [122, 24]]), 'line', undefined));
  // spinal cord and nerves
  s.push(path(line([[110, 62], [110, 234]]), 'line', 'spinal nervous'));
  const nerve = (pts) => [path(curve(pts), 'line', 'nerves nervous'), path(curve(mir(pts)), 'line', 'nerves nervous')];
  s.push(...nerve([[110, 100], [76, 108], [54, 150], [44, 206]]), ...nerve([[110, 232], [98, 290], [94, 370], [92, 448]]));
  // thyroid, airways, lungs, heart
  s.push(ell(103, 81, 6, 4, 'organ', 'thyroid endocrine'), ell(117, 81, 6, 4, 'organ', 'thyroid endocrine'));
  s.push(path(line([[110, 64], [110, 102], [100, 114]]), 'line', 'lung respiratory'), path(line([[110, 102], [120, 114]]), 'line', 'lung respiratory'));
  s.push(...both([[100, 102], [88, 106], [76, 124], [74, 148], [84, 160], [100, 156], [104, 128]], 'organ', 'lung respiratory'));
  s.push(path(blob([[104, 126], [114, 118], [124, 122], [128, 136], [120, 154], [110, 160], [104, 144]]), 'organ', 'heart circulatory'));
  // vessels
  s.push(path(line([[112, 158], [112, 236]]), 'line', 'vessels circulatory'));
  s.push(path(curve([[112, 236], [100, 262], [96, 330], [94, 440]]), 'line', 'vessels circulatory'), path(curve([[112, 236], [124, 262], [128, 330], [126, 440]]), 'line', 'vessels circulatory'));
  s.push(path(curve([[116, 124], [90, 100], [60, 106], [48, 170]]), 'line', 'vessels circulatory'), path(curve([[104, 124], [130, 100], [160, 106], [172, 170]]), 'line', 'vessels circulatory'));
  // digestive organs, spleen, kidneys, bowel
  s.push(ell(92, 207, 6, 11, 'organ', 'kidney urinary'), ell(128, 207, 6, 11, 'organ', 'kidney urinary'));
  s.push(path(blob([[78, 166], [98, 162], [120, 168], [124, 182], [106, 192], [88, 188], [80, 178]]), 'organ', 'liver digestive'));
  s.push(path(blob([[124, 166], [140, 164], [148, 178], [144, 196], [130, 200], [122, 186]]), 'organ', 'stomach digestive'));
  s.push(ell(153, 178, 6, 11, 'organ', 'spleen'));
  s.push(path(blob([[100, 199], [120, 195], [140, 199], [140, 207], [118, 205], [100, 209]]), 'organ', 'pancreas digestive endocrine'));
  s.push(path(blob([[88, 216], [132, 216], [136, 236], [124, 248], [96, 248], [84, 236]]), 'organ', 'intestine digestive'));
  s.push(path(curve([[94, 224], [102, 232], [110, 224], [118, 232], [126, 224]]), 'line', undefined));
  s.push(path(line([[82, 210], [82, 252], [138, 252], [138, 210]]), 'line', 'colon digestive'));
  // pelvic organs
  s.push(path(blob([[103, 240], [117, 240], [119, 252], [110, 260], [101, 252]]), 'organ', 'uterus reproductive'));
  s.push(ell(95, 244, 4, 3, 'organ', 'uterus reproductive'), ell(125, 244, 4, 3, 'organ', 'uterus reproductive'));
  s.push(ell(110, 270, 10, 7, 'organ', 'bladder urinary'));
  return s;
}

function skeleton() {
  const s = bodyShapes('skeleton');
  s.push(ell(110, 34, 20, 24, 'bone', 'skull skeleton'), path(blob([[98, 52], [110, 62], [122, 52], [118, 58], [110, 66], [102, 58]]), 'bone', 'skull skeleton'));
  for (let i = 0; i < 24; i++) s.push(el('rect', { x: 106.5, y: f(68 + i * 6.9), width: 7, height: 5, rx: 1.5, class: 'bone', 'data-t': 'spine skeleton' }));
  for (let i = 0; i < 6; i++) {
    const y = 98 + i * 9;
    const r = [[108, y], [92, y + 2], [80, y + 12], [78, y + 24]];
    s.push(path(curve(r), 'line', 'ribs skeleton'), path(curve(mir(r)), 'line', 'ribs skeleton'));
  }
  s.push(el('rect', { x: 107, y: 98, width: 6, height: 44, rx: 3, class: 'bone', 'data-t': 'ribs skeleton' }));
  s.push(path(curve([[108, 92], [90, 90], [70, 96]]), 'line', 'shoulderbone skeleton'), path(curve([[112, 92], [130, 90], [150, 96]]), 'line', 'shoulderbone skeleton'));
  s.push(path(blob([[82, 228], [110, 234], [138, 228], [150, 246], [138, 268], [110, 262], [82, 268], [70, 246]]), 'bone', 'pelvisbone skeleton'));
  s.push(...both([[50, 102], [64, 104], [58, 174], [46, 172]], 'bone', 'humerus skeleton'));
  s.push(...both([[44, 178], [52, 180], [46, 238], [38, 236]], 'bone', 'forearmbone skeleton'), ...both([[53, 180], [60, 182], [53, 238], [48, 238]], 'bone', 'forearmbone skeleton'));
  s.push(...both([[34, 242], [52, 244], [50, 272], [36, 276]], 'bone', 'handbone skeleton'));
  s.push(...both([[86, 272], [106, 274], [101, 360], [90, 360]], 'bone', 'femur skeleton'));
  s.push(ell(95, 367, 6, 7, 'bone', 'kneebone skeleton'), ell(W - 95, 367, 6, 7, 'bone', 'kneebone skeleton'));
  s.push(...both([[88, 376], [100, 376], [96, 452], [90, 452]], 'bone', 'tibia skeleton'));
  s.push(...both([[82, 454], [102, 454], [106, 470], [74, 472]], 'bone', 'footbone skeleton'));
  return s;
}

const views = { surface: surface(), back: back(), organs: organs(), skeleton: skeleton() };
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 490" role="img">`,
  '<title>Schematic human body</title>',
  '<desc>Original schematic body diagrams, CC0 1.0. Front surface, back, internal organs and skeleton views.</desc>',
  ...Object.entries(views).map(([v, shapes]) => `<g class="view" data-view="${v}">\n${shapes.join('\n')}\n</g>`),
  '</svg>',
  '',
].join('\n');
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);
