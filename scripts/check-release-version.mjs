import { readFileSync } from 'node:fs';
import process from 'node:process';

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packageJson = readJson(new URL('../package.json', import.meta.url));
const tauriConfig = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url));
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

const cargoPackageSection = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
const cargoVersionMatch = cargoPackageSection?.[1]?.match(/^\s*version\s*=\s*"([^"]+)"/m);

if (!cargoVersionMatch) {
  fail('Could not read the package version from src-tauri/Cargo.toml.');
}

const versions = {
  'package.json': packageJson.version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
  'src-tauri/Cargo.toml': cargoVersionMatch[1],
};

const uniqueVersions = [...new Set(Object.values(versions))];

if (uniqueVersions.length !== 1) {
  console.error('Release version mismatch detected:');
  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version}`);
  }
  process.exit(1);
}

const version = uniqueVersions[0];
const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;

if (refType === 'tag') {
  const expectedTag = `v${version}`;
  if (refName !== expectedTag) {
    fail(`Tag/version mismatch: expected ${expectedTag} but workflow ran for ${refName}.`);
  }
}

console.log(`Release version verified: ${version}`);
