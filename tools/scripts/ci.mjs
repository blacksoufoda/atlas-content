// Orquestra a publicacao no GitHub Actions (roda no repo PUBLICO, que le o repo privado da Luna).
//   (opcional) restaurar conteudo de um commit (rollback) -> conferir caminhos -> validar
//   -> invalido: restaura a ultima versao boa NO REPO DA LUNA, registra o motivo, falha o job
//   -> valido: publica em published/, registra status e historico
// Regras: a main do repo fonte fica sempre valida; o publico so avanca com conteudo valido.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathProblems } from './guards.mjs';
import { check, loadParser, publish } from './pipeline.mjs';

const PARSER = loadParser();

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(TOOLS, '..');
const SOURCE = resolve(process.env.SOURCE_DIR ?? join(REPO, 'source'));
const PUBLISHED = join(REPO, 'published');
const STATUS = join(SOURCE, 'status', 'last-run.json');

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function identity(cwd) {
  run(cwd, 'config', 'user.name', 'atlas-content-bot');
  run(cwd, 'config', 'user.email', 'atlas-content-bot@users.noreply.github.com');
}

function commitAndPush(cwd, message) {
  run(cwd, 'add', '-A');
  if (run(cwd, 'status', '--porcelain') === '') return false;
  run(cwd, 'commit', '-m', message);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      run(cwd, 'push', 'origin', 'HEAD:main');
      return true;
    } catch {
      run(cwd, 'pull', '--rebase', 'origin', 'main');
    }
  }
  throw new Error('Nao consegui enviar para main.');
}

function main() {
  identity(SOURCE);
  identity(REPO);
  const restoreSha = (process.env.RESTORE_SHA ?? '').trim();
  const runUrl = process.env.RUN_URL ?? '';
  const previous = readJson(STATUS, {});
  const lastGood = previous.lastGoodSourceSha ?? '';

  if (restoreSha) {
    run(SOURCE, 'restore', `--source=${restoreSha}`, '--staged', '--worktree', '--', 'content');
    commitAndPush(SOURCE, `rollback: conteudo restaurado de ${restoreSha.slice(0, 7)}`);
  }
  const head = run(SOURCE, 'rev-parse', 'HEAD');
  const tree = run(SOURCE, 'rev-parse', 'HEAD:content');
  const changedNames = lastGood ? run(SOURCE, 'diff', '--name-only', lastGood, head).split('\n').filter((n) => n && !n.startsWith('status/')) : ['*'];
  if (!restoreSha && changedNames.length === 0 && process.env.FORCE !== '1') {
    console.log('Nada novo em content/ desde a ultima verificacao.');
    return;
  }

  const errors = [];
  if (lastGood) {
    const names = run(SOURCE, 'diff', '--name-only', lastGood, head).split('\n').filter(Boolean);
    const outside = pathProblems(names);
    if (outside.length > 0) {
      // Mudanca fora de content/ so vale quando o commit se declara com [infra] (dono do repo, nao a Luna).
      const bad = names.filter((n) => pathProblems([n]).length > 0);
      const subjects = run(SOURCE, 'log', '--format=%s', `${lastGood}..${head}`, '--', ...bad).split('\n').filter(Boolean);
      if (subjects.some((s) => !s.includes('[infra]'))) errors.push(...outside);
    }
  }
  const report = check({ parser: PARSER, contentDir: join(SOURCE, 'content'), publishedDir: PUBLISHED });
  errors.push(...report.errors);
  const at = new Date().toISOString();
  const heartbeat = report.heartbeat ?? null;

  if (errors.length > 0) {
    let revertedTo = '';
    if (lastGood) {
      run(SOURCE, 'read-tree', '-u', '--reset', lastGood);
      revertedTo = lastGood;
    }
    const lastFailure = { at, sourceSha: head, errors: errors.slice(0, 20), revertedTo };
    const status = { ...previous, at, heartbeat, ok: false, paused: false, sourceSha: head, lastGoodSourceSha: lastGood, lastFailure, runUrl };
    commitAndPush(SOURCE, `revert automatico: conteudo invalido (${errors.length} erro(s))\n\n${errors.slice(0, 20).join('\n')}`);
    status.contentTree = run(SOURCE, 'rev-parse', 'HEAD:content');
    writeJson(STATUS, status);
    commitAndPush(SOURCE, `status: barrado (${head.slice(0, 7)})`);
    writeJson(join(PUBLISHED, 'status.json'), { at, ok: false, lastGoodAt: previous.lastGoodAt ?? null, errors: errors.slice(0, 20) });
    commitAndPush(REPO, 'status: ultima tentativa foi barrada');
    console.error(errors.join('\n'));
    process.exit(1);
  }

  let published = [];
  if (!report.paused) {
    published = publish({ report, publishedDir: PUBLISHED, sourceSha: head, message: run(SOURCE, 'log', '-1', '--pretty=%s') });
    // Prova final: o que acabou de ser escrito tem que ser aceito pelo parser do app. Senao nada vai para main.
    for (const area of published) {
      const again = PARSER.parseContentPack(readFileSync(join(PUBLISHED, `${area}.json`), 'utf8'), new Date());
      if (!again.ok) {
        console.error(`publicado de ${area} nao passa no parser do app: ${again.error}`);
        process.exit(1);
      }
    }
  }
  writeJson(join(PUBLISHED, 'status.json'), { at, ok: true, paused: report.paused, lastGoodAt: at, heartbeat, published });
  commitAndPush(REPO, `publica: ${published.length ? published.join(', ') : 'sem mudancas'} (${head.slice(0, 7)})`);
  const status = { ...previous, at, heartbeat, ok: true, paused: report.paused, sourceSha: head, lastGoodSourceSha: head, lastGoodAt: at, contentTree: tree, published, warnings: report.warnings, runUrl };
  writeJson(STATUS, status);
  commitAndPush(SOURCE, `status: ${report.paused ? 'pausado' : published.length ? 'publicado' : 'sem mudancas'} (${head.slice(0, 7)})`);
  console.log(JSON.stringify({ published, paused: report.paused, warnings: report.warnings }));
}

main();
