#!/usr/bin/env node
/**
 * Coverage check using stable @AUDIT annotations.
 * Reads @AUDIT metadata from HTML comments, extracts data from script,
 * and verifies every declared character is reachable via the scoring algorithm.
 * Pure JS — no browser, no DOM.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// ── Read stable @AUDIT annotations ──────────────────────────────────────────
// Find the STABLE AUDIT INTERFACE HTML comment block
const auditBlock = html.match(/<!--\s*⛔⛔⛔ STABLE AUDIT INTERFACE[\s\S]*?-->/);
if (!auditBlock) { console.error('❌ Missing STABLE AUDIT INTERFACE block'); process.exit(2); }
const auditText = auditBlock[0]; // use full comment including <!-- and -->

// Parse @AUDIT key=value pairs (line containing @AUDIT followed by space-separated key=value)
const auditLine = auditText.match(/^\s*@AUDIT\s+([a-zA-Z0-9=.\-_ ]+)$/m);
const audit = {};
if (auditLine) {
  auditLine[1].trim().split(/\s+/).forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) audit[k] = v;
  });
}
console.log(`@AUDIT: version=${audit.version} algorithm=${audit.algorithm} chars=${audit.chars} questions=${audit.questions}`);

// Parse @AUDIT_CHARS list (line starting with @AUDIT_CHARS followed by space-separated ids)
const charsLine = auditText.match(/^\s*@AUDIT_CHARS\s+(.+)$/m);
if (!charsLine) { console.error('❌ Missing @AUDIT_CHARS'); process.exit(2); }
const auditCharIds = charsLine[1].trim().split(/\s+/).filter(Boolean);
console.log(`@AUDIT_CHARS: ${auditCharIds.length} ids declared`);

// ── Parse quiz data from script ─────────────────────────────────────────────
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Read audit annotation from script
const scriptAudit = script.match(/\/\*@AUDIT:([^*]+)\*\//);
if (scriptAudit) console.log(`@AUDIT(js): ${scriptAudit[1].trim()}`);

const cMatch = script.match(/const C = \[([\s\S]*?)\];/);
if (!cMatch) { console.error('❌ Cannot parse C array'); process.exit(2); }
const qMatch = script.match(/const Q = \[([\s\S]*?)\];/);
if (!qMatch) { console.error('❌ Cannot parse Q array'); process.exit(2); }

const cFunc = new Function(`function c(id,name,meta,tags,v,desc){return {id,name,meta,tags,v,desc};}return [${cMatch[1]}];`);
const qFunc = new Function(`function q(text,...opts){return {q:text,o:opts};}function a(text,tags){return {text,tags};}return [${qMatch[1]}];`);

const chars = cFunc();
const questions = qFunc();

// ── Audit consistency checks ────────────────────────────────────────────────
if (chars.length !== +audit.chars) {
  console.error(`❌ @AUDIT chars=${audit.chars} but C array has ${chars.length}`);
  process.exit(1);
}
if (questions.length !== +audit.questions) {
  console.error(`❌ @AUDIT questions=${audit.questions} but Q array has ${questions.length}`);
  process.exit(1);
}

const actualIds = chars.map(c => c.id).sort().join(' ');
const declaredIds = [...auditCharIds].sort().join(' ');
if (actualIds !== declaredIds) {
  console.error(`❌ @AUDIT_CHARS mismatch:`);
  console.error(`  Declared: ${declaredIds}`);
  console.error(`  Actual:   ${actualIds}`);
  process.exit(1);
}
console.log('✓ @AUDIT_CHARS matches C array');

// Check every ID appears in at least one answer
const idsInAnswers = new Set();
questions.forEach(q => q.o.forEach(o => Object.keys(o.tags).forEach(k => {
  if (chars.some(c => c.id === k)) idsInAnswers.add(k);
})));
const missing = chars.filter(c => !idsInAnswers.has(c.id)).map(c => c.id);
if (missing.length > 0) {
  console.error(`❌ IDs not in any answer: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('✓ All character IDs appear in answer options');

// ── Build exposure & scoring ─────────────────────────────────────────────────
function buildExposure(items) {
  const out = Object.create(null);
  for (const q of items)
    for (const opt of q.o)
      for (const [k, v] of Object.entries(opt.tags || {}))
        out[k] = (out[k] || 0) + Math.abs(v);
  return out;
}
const exposure = buildExposure(questions);

function scaled(k, v) { return v / Math.sqrt(exposure[k] || 1); }

function sim(ch, score) {
  let dot = 0, norm = 0;
  for (const [k, v] of Object.entries(ch.v || {})) {
    const cv = scaled(k, v), sv = scaled(k, score[k] || 0);
    dot += sv * cv; norm += cv * cv;
  }
  let s = norm ? dot / Math.sqrt(norm) : 0;
  if (score[ch.id]) s += 6 * scaled(ch.id, score[ch.id]);
  return s;
}

function ranked(score) {
  return chars.map(ch => ({ ch, s: sim(ch, score) })).sort((a, b) => b.s - a.s);
}

// ── Greedy coverage search ──────────────────────────────────────────────────
function bestOption(target, score, qIdx) {
  const q = questions[qIdx];
  let best = null, bestDiff = -Infinity;
  for (const opt of q.o) {
    const trial = Object.create(null);
    for (const [k, v] of Object.entries(score)) trial[k] = v;
    for (const [k, v] of Object.entries(opt.tags)) trial[k] = (trial[k] || 0) + v;
    const targetS = sim(target, trial);
    const maxComp = Math.max(...chars.filter(c => c.id !== target.id).map(c => sim(c, trial)));
    if (targetS - maxComp > bestDiff) { bestDiff = targetS - maxComp; best = opt; }
  }
  return best;
}

function tryReach(target) {
  const score = Object.create(null);
  for (let i = 0; i < questions.length; i++) {
    const opt = bestOption(target, score, i);
    if (!opt) return null;
    for (const [k, v] of Object.entries(opt.tags)) score[k] = (score[k] || 0) + v;
  }
  const r = ranked(score);
  return { winner: r[0].ch.id, match: r[0].ch.id === target.id, rank: r.findIndex(x => x.ch.id === target.id) };
}

// ── Run coverage ────────────────────────────────────────────────────────────
console.log('\n=== Coverage ===');
let pass = true;
for (const ch of chars) {
  const r = tryReach(ch);
  const ok = r && r.match;
  if (!ok) pass = false;
  console.log(`${ok ? '✓' : '✗'} ${ch.name.padEnd(24)} ${r ? `rank#${r.rank}` : 'N/A'}`);
}

if (!pass) { console.error('\n❌ Some characters unreachable'); process.exit(1); }
console.log(`\n✅ ${chars.length}/${chars.length} reachable`);
