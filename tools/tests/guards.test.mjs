import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeSizeProblems,
  healthProblems,
  heartbeatProblems,
  isDroppedIssue,
  pathProblems,
  personalDataProblems,
  reviewerProblems,
  userApprovalProblems,
} from '../scripts/guards.mjs';

const tip = (id, extra = {}) => ({ id, title: 'T', oneLine: 'x', steps: ['a'], ...extra });
const pack = (...tips) => ({ tips, concepts: [], videos: [] });

test('bloqueia e-mail, CPF, telefone, cartao, token e senha', () => {
  for (const text of [
    'fale com ana@exemplo.com',
    'CPF 123.456.789-09',
    'ligue (21) 98888-7777',
    'cartao 4111 1111 1111 1111',
    'token ghp_abcdefghijklmnop',
    'senha: abc123',
  ]) {
    assert.ok(personalDataProblems(pack(tip('aaa', { oneLine: text }))).length > 0, text);
  }
});

test('texto comum nao dispara dado pessoal', () => {
  assert.deepEqual(
    personalDataProblems(pack(tip('aaa', { oneLine: 'Respire por 5 minutos e olhe o material.' }))),
    [],
  );
});

test('bloqueia medicamento, dose, meta de calorias e de peso', () => {
  for (const text of ['tome Ritalina de manha', 'use 10 mg por dia', 'coma 1500 kcal', 'tente perder 5 kg']) {
    assert.ok(healthProblems(pack(tip('aaa', { oneLine: text }))).length > 0, text);
  }
  assert.deepEqual(healthProblems(pack(tip('aaa', { oneLine: 'Converse com quem acompanha voce.' }))), []);
});

test('so o revisor "Luna" e aceito', () => {
  assert.deepEqual(reviewerProblems(pack(tip('aaa', { reviewedBy: 'Luna' }))), []);
  assert.equal(reviewerProblems(pack(tip('aaa', { reviewedBy: 'Dra. Ana' }))).length, 1);
});

test('aprovado por voce exige registro em userApprovedIds', () => {
  const next = pack(tip('aaa', { approvedByUserAt: '2026-11-19' }));
  assert.equal(userApprovalProblems(next, pack(tip('aaa')), {}).length, 1);
  assert.deepEqual(userApprovalProblems(next, pack(tip('aaa')), { userApprovedIds: ['aaa'] }), []);
  assert.deepEqual(userApprovalProblems(next, next, {}), []);
});

test('limites de mudanca em massa', () => {
  const many = (n, extra = {}) => pack(...Array.from({ length: n }, (_, i) => tip(`dica-${i}`, extra)));
  assert.equal(changeSizeProblems(many(41), pack()).length, 1);
  assert.equal(changeSizeProblems(pack(), many(11)).length >= 1, true);
  assert.deepEqual(changeSizeProblems(many(10), many(10)), []);
  assert.equal(changeSizeProblems(many(2), many(10)).length >= 1, true);
});

test('caminhos permitidos', () => {
  assert.deepEqual(pathProblems(['content/helm.json', 'content/_control.json', 'status/last-run.json']), []);
  assert.equal(pathProblems(['validator/helm-content-pack.ts', '.github/workflows/publish.yml']).length, 2);
  assert.equal(pathProblems(['content/study.json']).length, 1);
});

test('batimento da Luna e validado e o caminho e permitido', () => {
  assert.deepEqual(pathProblems(['content/_heartbeat.json']), []);
  const ok = { schema: 'atlas-content-heartbeat-v1', lastRunAt: '2026-11-19T20:00:00Z', summary: 'Revisei 6 itens. Nada mudou.', changed: false };
  assert.deepEqual(heartbeatProblems(ok), []);
  assert.deepEqual(heartbeatProblems(null), []);
  assert.ok(heartbeatProblems({ ...ok, lastRunAt: 'ontem' }).length > 0);
  assert.ok(heartbeatProblems({ ...ok, summary: '' }).length > 0);
  assert.ok(heartbeatProblems({ ...ok, changed: 'nao' }).length > 0);
});

test('itens descartados pelo parser sao erro', () => {
  assert.ok(isDroppedIssue('dica #3: item inválido, ignorado'));
  assert.ok(isDroppedIssue('dica abc: id repetido, ignorado'));
  assert.ok(!isDroppedIssue('dica abc: ficou como rascunho (vencido)'));
});
