#!/usr/bin/env node
/**
 * Coverage check: verify every character can be matched by some answer path.
 * Uses exposure-normalized cosine similarity (mirrors index.html algorithm).
 * Exits 0 if all characters are reachable, 1 otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Parse quiz data from index.html ──────────────────────────────────────────
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const cMatch = script.match(/const C = \[([\s\S]*?)\];/);
if (!cMatch) { console.error('Cannot parse C array'); process.exit(2); }
const qMatch = script.match(/const Q = \[([\s\S]*?)\];/);
if (!qMatch) { console.error('Cannot parse Q array'); process.exit(2); }

const cFunc = new Function(`function c(id,name,meta,tags,v,desc){return {id,name,meta,tags,v,desc};}return [${cMatch[1]}];`);
const qFunc = new Function(`function q(text,...opts){return {q:text,o:opts};}function a(text,tags){return {text,tags};}return [${qMatch[1]}];`);

const chars = cFunc();
const questions = qFunc();

// ── Build exposure ───────────────────────────────────────────────────────────
function buildExposure(items) {
  const out = Object.create(null);
  for (const q of items)
    for (const opt of q.o)
      for (const [k, v] of Object.entries(opt.tags || {}))
        out[k] = (out[k] || 0) + Math.abs(v);
  return out;
}
const exposure = buildExposure(questions);

// ── Scoring ──────────────────────────────────────────────────────────────────
function scaled(k, v) {
  return v / Math.sqrt(exposure[k] || 1);
}

function computeScore(answers) {
  const s = Object.create(null);
  for (const ans of answers)
    for (const [k, v] of Object.entries(ans.tags))
      s[k] = (s[k] || 0) + v;
  return s;
}

function sim(ch, score) {
  let dot = 0, norm = 0;
  for (const [k, v] of Object.entries(ch.v || {})) {
    const cv = scaled(k, v);
    const sv = scaled(k, score[k] || 0);
    dot += sv * cv;
    norm += cv * cv;
  }
  let s = norm ? dot / Math.sqrt(norm) : 0;
  if (score[ch.id]) s += 6 * scaled(ch.id, score[ch.id]);
  return s;
}

function ranked(score) {
  return chars.map(ch => ({ ch, s: sim(ch, score) })).sort((a, b) => b.s - a.s);
}

function pick(score) {
  const r = ranked(score);
  return { ch: r[0].ch, ranked: r };
}

// ── Coverage search: greedy best-for-target ──────────────────────────────────
function bestOptionForChar(target, score, qIdx) {
  const q = questions[qIdx];
  let best = null;
  let bestDiff = -Infinity;

  for (const opt of q.o) {
    const trial = Object.create(null);
    for (const [k, v] of Object.entries(score)) trial[k] = v;
    for (const [k, v] of Object.entries(opt.tags)) trial[k] = (trial[k] || 0) + v;

    const targetS = sim(target, trial);
    const competitors = chars.filter(c => c.id !== target.id);
    const maxComp = Math.max(...competitors.map(c => sim(c, trial)));
    const diff = targetS - maxComp;

    if (diff > bestDiff) {
      bestDiff = diff;
      best = opt;
    }
  }
  return best;
}

function tryReach(target) {
  const score = Object.create(null);
  const path = [];

  for (let i = 0; i < questions.length; i++) {
    const opt = bestOptionForChar(target, score, i);
    if (!opt) return null;
    path.push(opt);
    for (const [k, v] of Object.entries(opt.tags))
      score[k] = (score[k] || 0) + v;
  }

  const result = pick(score);
  return {
    target: target.id,
    targetName: target.name,
    winner: result.ch.id,
    winnerName: result.ch.name,
    match: result.ch.id === target.id,
    targetRank: result.ranked.findIndex(r => r.ch.id === target.id),
    targetScore: sim(target, score),
    winnerScore: sim(chars.find(c => c.id === result.ch.id), score),
    path: path.map(o => o.text.slice(0, 25)),
  };
}

// ── Brute-force small search for hard cases ──────────────────────────────────
function bruteForce(target, maxQuestions = 6) {
  // For the last maxQuestions, try all combinations
  const baseQ = questions.length - maxQuestions;
  const targetScore = Object.create(null);
  const basePath = [];

  // First use greedy for the early questions
  for (let i = 0; i < baseQ; i++) {
    const opt = bestOptionForChar(target, targetScore, i);
    if (!opt) return null;
    basePath.push(opt);
    for (const [k, v] of Object.entries(opt.tags))
      targetScore[k] = (targetScore[k] || 0) + v;
  }

  // Brute force the last maxQuestions
  const optsPerQ = questions.slice(baseQ).map(q =>
    q.o.map((opt, oi) => ({ opt, oi }))
  );

  function* cartesian(arrays, prefix = []) {
    if (!arrays.length) { yield prefix; return; }
    for (const item of arrays[0])
      yield* cartesian(arrays.slice(1), [...prefix, item]);
  }

  let bestResult = null;
  let bestDiff = -Infinity;

  for (const combo of cartesian(optsPerQ)) {
    const trial = Object.create(null);
    for (const [k, v] of Object.entries(targetScore)) trial[k] = v;
    for (const { opt } of combo)
      for (const [k, v] of Object.entries(opt.tags))
        trial[k] = (trial[k] || 0) + v;

    const targetS = sim(target, trial);
    const result = pick(trial);
    const diff = targetS - (result.ch.id === target.id ? -Infinity : sim(result.ch, trial));

    if (result.ch.id === target.id || diff > bestDiff) {
      bestDiff = diff;
      bestResult = {
        score: trial,
        path: [...basePath, ...combo.map(c => c.opt)],
        winner: result.ch.id,
        match: result.ch.id === target.id,
        targetRank: result.ranked.findIndex(r => r.ch.id === target.id),
        targetScore: targetS,
      };
      if (result.ch.id === target.id) break; // Found!
    }
  }

  return bestResult ? {
    target: target.id,
    targetName: target.name,
    winner: bestResult.winner,
    match: bestResult.match,
    targetRank: bestResult.targetRank,
    targetScore: bestResult.targetScore,
    path: bestResult.path.map(o => o.text.slice(0, 25)),
  } : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`Characters: ${chars.length}, Questions: ${questions.length}`);
console.log(`Tag universe: ${Object.keys(exposure).length}\n`);

// Verify all character IDs appear in answers
const allIdsInAnswers = new Set();
questions.forEach(q => q.o.forEach(o => Object.keys(o.tags).forEach(k => {
  if (chars.some(c => c.id === k)) allIdsInAnswers.add(k);
})));
const missing = chars.filter(c => !allIdsInAnswers.has(c.id)).map(c => c.id);
if (missing.length > 0) {
  console.log(`⚠ Missing IDs from answers: ${missing.join(', ')}`);
}

console.log('=== Coverage Report ===\n');

let allReachable = true;
const unreachable = [];

for (const ch of chars) {
  let r = tryReach(ch);

  // If greedy fails, try brute force on last 5 questions
  if (!r || !r.match) {
    const bf = bruteForce(ch, 7);
    if (bf && bf.match) r = bf;
  }

  const status = r && r.match ? '✓' : '✗';
  const rankStr = r ? `rank#${r.targetRank}` : 'N/A';
  const scoreStr = r ? r.targetScore.toFixed(2) : 'N/A';
  const winnerStr = r ? r.winner : 'N/A';
  console.log(`${status} ${ch.name.padEnd(24)} ${winnerStr.padEnd(24)} ${rankStr} score=${scoreStr}`);

  if (!r || !r.match) {
    allReachable = false;
    unreachable.push({ ch, r });
  }
}

console.log(`\n=== Summary ===`);
console.log(`Reachable: ${chars.length - unreachable.length} / ${chars.length}`);

if (unreachable.length > 0) {
  console.log(`\n❌ UNREACHABLE (${unreachable.length}):`);
  for (const { ch, r } of unreachable) {
    console.log(`  ${ch.name}: greedy picks → ${r ? r.winner : 'null'} (rank #${r ? r.targetRank : '?'})`);
    if (r && r.path) console.log(`    path: ${r.path.join(' | ')}`);
  }
  process.exit(1);
} else {
  console.log('✅ All characters reachable');
}

// ── Competitiveness report ────────────────────────────────────────────────────
console.log('\n=== Competitiveness (greedy margin vs #2) ===');
const margins = [];
for (const ch of chars) {
  const r = tryReach(ch);
  if (!r) continue;
  const rnk = ranked(r.score || Object.create(null));
  const margin = rnk.length > 1 ? rnk[0].s - rnk[1].s : 99;
  margins.push({ name: ch.name, rank: r.targetRank, margin });
}
margins.sort((a, b) => a.margin - b.margin);
for (const m of margins) {
  const bar = m.margin > 0
    ? '█'.repeat(Math.min(50, Math.max(1, Math.round(m.margin * 8))))
    : '▁';
  console.log(`${m.name.padEnd(24)} rank#${m.rank} margin=${m.margin.toFixed(2)} ${bar}`);
}
