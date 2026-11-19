import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { MIN_VERSION, check, loadParser, publish } from '../scripts/pipeline.mjs';

let parser;
let work;
const made = [];
const NOW = new Date('2026-11-19T20:00:00Z');

before(() => {
  parser = loadParser();
});
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh() {
  work = mkdtempSync(join(tmpdir(), 'atlas-content-'));
  made.push(work);
  const content = join(work, 'content');
  mkdirSync(content);
  cpSync(new URL('./fixtures/helm.json', import.meta.url), join(content, 'helm.json'));
  cpSync(new URL('./fixtures/_control.json', import.meta.url), join(content, '_control.json'));
  return { content, published: join(work, 'published') };
}
const edit = (content, fn) => {
  const file = join(content, 'helm.json');
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  fn(pack);
  writeFileSync(file, JSON.stringify(pack));
};

test('conteudo semente e valido e publica a versao minima', () => {
  const { content, published } = fresh();
  const report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
  assert.deepEqual(publish({ report, publishedDir: published, now: NOW }), ['helm']);
  const out = JSON.parse(readFileSync(join(published, 'helm.json'), 'utf8'));
  assert.equal(out.version, MIN_VERSION);
  assert.equal(out.tips.length, 6);
  const index = JSON.parse(readFileSync(join(published, 'index.json'), 'utf8'));
  assert.equal(index.areas.helm.version, MIN_VERSION);
  assert.equal(JSON.parse(readFileSync(join(published, 'changelog.json'), 'utf8'))[0].added.length, 6);
});

test('sem mudanca de conteudo nao publica de novo', () => {
  const { content, published } = fresh();
  let report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  publish({ report, publishedDir: published, now: NOW });
  report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  assert.equal(report.areas.helm.changed, false);
  assert.deepEqual(publish({ report, publishedDir: published, now: NOW }), []);
});

test('mudanca valida sobe a versao em 1 e entra no historico', () => {
  const { content, published } = fresh();
  let report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  publish({ report, publishedDir: published, now: NOW });
  edit(content, (pack) => {
    pack.tips[0].oneLine = 'Uma frase nova e gentil para conferir como o dia esta.';
  });
  report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  assert.equal(report.ok, true);
  assert.deepEqual(publish({ report, publishedDir: published, now: NOW, message: 'ajuste' }), ['helm']);
  assert.equal(JSON.parse(readFileSync(join(published, 'helm.json'), 'utf8')).version, MIN_VERSION + 1);
  assert.equal(JSON.parse(readFileSync(join(published, 'changelog.json'), 'utf8')).length, 2);
});

test('barra JSON invalido, dado pessoal, remedio e revisor falso', () => {
  const cases = [
    ['dado pessoal', (p) => (p.tips[0].oneLine = 'Escreva para ana@exemplo.com agora.')],
    ['remedio', (p) => (p.tips[0].oneLine = 'Tome 10 mg de manha para focar melhor.')],
    ['revisor falso', (p) => (p.tips[0].reviewedBy = 'Dra. Ana')],
    ['item malformado', (p) => (p.tips[1].steps = [])],
    ['id repetido', (p) => (p.tips[1].id = p.tips[0].id)],
  ];
  for (const [name, mutate] of cases) {
    const { content, published } = fresh();
    edit(content, mutate);
    const report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
    assert.equal(report.ok, false, name);
    assert.ok(report.errors.length > 0, name);
  }
  const { content, published } = fresh();
  writeFileSync(join(content, 'helm.json'), '{ nao e json');
  assert.equal(check({ parser, contentDir: content, publishedDir: published, now: NOW }).ok, false);
});

test('barra remocao em massa e aprovacao do usuario sem registro', () => {
  const { content, published } = fresh();
  let report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  publish({ report, publishedDir: published, now: NOW });
  edit(content, (p) => (p.tips = p.tips.slice(0, 1)));
  report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  assert.equal(report.ok, false);

  const fresh2 = fresh();
  writeFileSync(join(fresh2.content, '_control.json'), JSON.stringify({ paused: false }));
  const r2 = check({ parser, contentDir: fresh2.content, publishedDir: fresh2.published, now: NOW });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('aprovacao do usuario')));
});

test('pausado: nao valida nem publica', () => {
  const { content, published } = fresh();
  writeFileSync(join(content, '_control.json'), JSON.stringify({ paused: true }));
  const report = check({ parser, contentDir: content, publishedDir: published, now: NOW });
  assert.equal(report.paused, true);
  assert.deepEqual(report.areas, {});
});
