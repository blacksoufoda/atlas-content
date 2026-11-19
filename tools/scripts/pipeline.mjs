// Validacao e publicacao. Uso (no CI e local):
//   node scripts/pipeline.mjs check   --published <dir>              -> escreve .build/report.json
//   node scripts/pipeline.mjs publish --published <dir>              -> grava <dir>/<area>.json, index.json, changelog.json
// Nada aqui chama a rede. O parser e o mesmo codigo do app (validator/, sincronizado por teste no app).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AREAS,
  changeSizeProblems,
  healthProblems,
  heartbeatProblems,
  isDroppedIssue,
  personalDataProblems,
  reviewerProblems,
  userApprovalProblems,
} from './guards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // tools/
const REPO = resolve(ROOT, '..'); // raiz do repo publico
/** O app instalado ja pode ter guardado a versao 2 (Drive). O primeiro pacote daqui precisa ser maior. */
export const MIN_VERSION = 3;
const CHANGELOG_LIMIT = 50;

export function loadParser() {
  const out = join(ROOT, '.build', 'validator.cjs');
  mkdirSync(dirname(out), { recursive: true });
  const esbuild = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  execFileSync(
    esbuild,
    [join(ROOT, 'validator', 'helm-content-pack.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=error'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  return createRequire(import.meta.url)(out);
}

const readJson = (path, fallback = null) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

/** O conteudo sem os campos que o publicador carimba. Serve para saber se algo mudou de verdade. */
const comparable = (pack) => JSON.stringify({ ...pack, version: 0, generatedAt: '' });
const stripStamp = (text) => {
  try {
    return comparable(JSON.parse(text));
  } catch {
    return '';
  }
};

export function check({ parser, contentDir, publishedDir, now = new Date() }) {
  const errors = [];
  const warnings = [];
  const control = readJson(join(contentDir, '_control.json'), {});
  const heartbeat = readJson(join(contentDir, '_heartbeat.json'), null);
  errors.push(...heartbeatProblems(heartbeat));
  const report = { ok: true, paused: control.paused === true, errors, warnings, areas: {}, heartbeat };
  if (report.paused) {
    report.ok = errors.length === 0;
    return report;
  }
  for (const area of AREAS) {
    const file = join(contentDir, `${area}.json`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const parsed = parser.parseContentPack(text, now);
    if (!parsed.ok) {
      errors.push(`${area}: ${parsed.error}`);
      continue;
    }
    for (const issue of parsed.issues) (isDroppedIssue(issue) ? errors : warnings).push(`${area}: ${issue}`);
    const previous = readJson(join(publishedDir, `${area}.json`), null);
    errors.push(
      ...personalDataProblems(parsed.pack),
      ...healthProblems(parsed.pack),
      ...reviewerProblems(parsed.pack),
      ...userApprovalProblems(parsed.pack, previous, control),
      ...(previous ? changeSizeProblems(parsed.pack, previous) : []),
    );
    report.areas[area] = {
      pack: parsed.pack,
      raw: JSON.parse(text),
      changed: !previous || stripStamp(text) !== comparable(previous),
      items: parsed.pack.tips.length + parsed.pack.concepts.length + parsed.pack.videos.length,
    };
  }
  report.ok = errors.length === 0;
  return report;
}

const idsOf = (pack) =>
  new Set(['tips', 'concepts', 'videos'].flatMap((list) => (pack?.[list] ?? []).map((i) => `${list}:${i.id}`)));

export function publish({ report, publishedDir, sourceSha = '', message = '', now = new Date() }) {
  mkdirSync(publishedDir, { recursive: true });
  const index = readJson(join(publishedDir, 'index.json'), { schema: 'atlas-content-index-v1', areas: {} });
  const changelog = readJson(join(publishedDir, 'changelog.json'), []);
  const wrote = [];
  for (const [area, info] of Object.entries(report.areas)) {
    if (!info.changed) continue;
    const previous = readJson(join(publishedDir, `${area}.json`), null);
    const version = Math.max((previous?.version ?? 0) + 1, MIN_VERSION);
    // Publica o proprio texto validado (com schema), so carimbando versao e data: o app le o que a validacao viu.
    const pack = { ...info.raw, version, generatedAt: now.toISOString() };
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    writeFileSync(join(publishedDir, `${area}.json`), text);
    index.areas[area] = {
      file: `${area}.json`,
      version,
      items: info.items,
      sha256: createHash('sha256').update(text).digest('hex'),
      updatedAt: now.toISOString(),
    };
    const before = idsOf(previous);
    const after = idsOf(pack);
    changelog.unshift({
      at: now.toISOString(),
      area,
      version,
      sourceSha,
      message: message.slice(0, 200),
      added: [...after].filter((id) => !before.has(id)),
      removed: [...before].filter((id) => !after.has(id)),
    });
    wrote.push(area);
  }
  if (wrote.length > 0) {
    index.generatedAt = now.toISOString();
    writeFileSync(join(publishedDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    writeFileSync(join(publishedDir, 'changelog.json'), `${JSON.stringify(changelog.slice(0, CHANGELOG_LIMIT), null, 2)}\n`);
  }
  return wrote;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const arg = (name, fallback) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? rest[at + 1] : fallback;
  };
  const publishedDir = resolve(arg('published', join(REPO, 'published')));
  const contentDir = join(resolve(process.env.SOURCE_DIR ?? join(REPO, 'source')), 'content');
  const reportFile = join(ROOT, '.build', 'report.json');
  mkdirSync(dirname(reportFile), { recursive: true });
  const parser = loadParser();
  if (command === 'check') {
    const report = check({ parser, contentDir, publishedDir });
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, paused: report.paused, errors: report.errors, warnings: report.warnings }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
  if (command === 'publish') {
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    if (!report.ok || report.paused) throw new Error('Nada a publicar: relatorio invalido ou pausado.');
    const wrote = publish({ report, publishedDir, sourceSha: arg('sha', ''), message: arg('message', '') });
    console.log(JSON.stringify({ published: wrote }));
    return;
  }
  throw new Error('Uso: pipeline.mjs check|publish --published <dir>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
