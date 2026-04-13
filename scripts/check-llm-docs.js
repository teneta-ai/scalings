#!/usr/bin/env node

// Validates that llms-full.txt and docs.md stay in sync with the source of truth
// in src/interfaces/types.ts. Run via: npm run check:docs
//
// Checks:
// 1. Every service/client/broker/simulation parameter from DEFAULT_* appears in both doc files
// 2. Every traffic pattern type is documented
// 3. Every preset scenario name is documented

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function read(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8');
}

const types = read('src/interfaces/types.ts');
const llmsFull = read('llms-full.txt');
const docs = read('docs.md');

let errors = 0;

function check(field, file, fileName) {
  // Look for the field name as a code reference or table entry
  if (!file.includes(field)) {
    console.error(`MISSING: "${field}" not found in ${fileName}`);
    errors++;
  }
}

// --- Extract parameter names from DEFAULT_* blocks in types.ts ---

function extractFields(source, blockName) {
  // Match "export const BLOCK_NAME: Type = { ... };" — grab field names
  const re = new RegExp(`export const ${blockName}[^{]*\\{([^}]+)\\}`, 's');
  const match = source.match(re);
  if (!match) {
    console.error(`Could not find ${blockName} in types.ts`);
    errors++;
    return [];
  }
  const body = match[1];
  // Extract "field_name:" patterns, skipping comments
  const fields = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('...')) continue;
    const fieldMatch = trimmed.match(/^(\w+)\s*:/);
    if (fieldMatch) fields.push(fieldMatch[1]);
  }
  return fields;
}

const serviceFields = extractFields(types, 'DEFAULT_SERVICE');
const clientFields = extractFields(types, 'DEFAULT_CLIENT');
const brokerFields = extractFields(types, 'DEFAULT_BROKER');
const simulationFields = extractFields(types, 'DEFAULT_SIMULATION');

const allFields = [
  ...serviceFields,
  ...clientFields,
  ...brokerFields,
  ...simulationFields,
];

console.log(`Checking ${allFields.length} parameters...`);

for (const field of allFields) {
  check(field, llmsFull, 'llms-full.txt');
  check(field, docs, 'docs.md');
}

// --- Extract traffic pattern types ---

const patternMatch = types.match(/export type TrafficPatternType\s*=\s*([^;]+);/);
if (patternMatch) {
  const patterns = patternMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  // Skip 'grafana' — it's for CSV import, not useful for programmatic URL construction
  const docPatterns = patterns.filter(p => p !== 'grafana');
  console.log(`Checking ${docPatterns.length} traffic patterns...`);
  for (const pattern of docPatterns) {
    check(pattern, llmsFull, 'llms-full.txt');
    check(pattern, docs, 'docs.md');
  }
} else {
  console.error('Could not find TrafficPatternType in types.ts');
  errors++;
}

// --- Extract preset names ---

const presetNames = [...types.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
// Filter to only preset scenario names (they appear in PRESET_SCENARIOS)
const presetSection = types.slice(types.indexOf('PRESET_SCENARIOS'));
const presetNamesInSection = [...presetSection.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
// Each preset has two name entries (one for the preset, one in config) — deduplicate
const uniquePresets = [...new Set(presetNamesInSection)];

console.log(`Checking ${uniquePresets.length} presets...`);
for (const preset of uniquePresets) {
  check(preset, llmsFull, 'llms-full.txt');
  check(preset, docs, 'docs.md');
}

// --- Extract platform types ---

const platformMatch = types.match(/export type Platform\s*=\s*([^;]+);/);
if (platformMatch) {
  const platforms = platformMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  console.log(`Checking ${platforms.length} platforms...`);
  for (const platform of platforms) {
    check(platform, llmsFull, 'llms-full.txt');
  }
}

// --- Summary ---

if (errors > 0) {
  console.error(`\n${errors} error(s) found. Update llms-full.txt and/or docs.md to match types.ts.`);
  process.exit(1);
} else {
  console.log('\nAll LLM doc checks passed.');
}
