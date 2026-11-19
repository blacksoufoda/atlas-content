// Guardas editoriais e de privacidade. Funcoes puras: recebem dados, devolvem lista de problemas.
// O parser do app (validator/) valida o formato; aqui fica o que o parser nao cobre.

export const AREAS = ['helm']; // areas que o app ja consome. Outras so entram quando houver consumidor.
export const MAX_ADDED_OR_CHANGED = 40;
export const MAX_REMOVED = 10;
export const MAX_REMOVED_FRACTION = 0.25;

const PERSONAL = [
  ['e-mail', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['telefone', /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/],
  ['CPF', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/],
  ['CNPJ', /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/],
  ['numero de cartao', /\b(?:\d[ -]?){13,19}\b/],
  ['chave ou token', /\b(?:ghp_|gho_|github_pat_|sk-|xox[abp]-|AKIA)[\w-]{8,}/],
  ['senha', /\b(?:senha|password|passwd)\s*[:=]\s*\S+/i],
];

const MEDICATION = [
  [
    'nome de medicamento',
    /\b(?:metilfenidato|ritalina|concerta|venvanse|lisdexanfetamina|fluoxetina|sertralina|escitalopram|citalopram|paroxetina|bupropiona|venlafaxina|duloxetina|amitriptilina|clonazepam|rivotril|alprazolam|diazepam|lorazepam|zolpidem|lit[ií]o|quetiapina|risperidona|aripiprazol|atomoxetina|modafinila|melatonina|canabidiol|cetamina)\b/i,
  ],
  ['dose ou posologia', /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|ml|gotas|comprimidos?|c[aá]psulas?)\b/i],
];

const DIET = [
  ['meta de calorias', /\b\d{3,4}\s?(?:kcal|calorias)\b/i],
  ['meta de peso', /\b(?:perder|emagrecer|ganhar)\s+\d+(?:[.,]\d+)?\s?kg\b/i],
  ['jejum prolongado', /\bjejum\s+de\s+\d{2,}\s?h/i],
];

const textsOf = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) textsOf(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) textsOf(v, out);
  return out;
};

function scan(label, rules, pack) {
  const problems = [];
  for (const list of ['tips', 'concepts', 'videos']) {
    for (const item of pack[list] ?? []) {
      const joined = textsOf(item).join(' \n ');
      for (const [name, re] of rules) {
        if (re.test(joined)) problems.push(`${label}: ${list.slice(0, -1)} ${item.id}: ${name}`);
      }
    }
  }
  return problems;
}

/** Nenhum dado pessoal, credencial ou numero que pareca documento pode ir para um repo publico. */
export const personalDataProblems = (pack) => scan('dado pessoal', PERSONAL, pack);

/** Conteudo de saude: sem medicamento especifico, dose, meta de calorias ou de peso. */
export const healthProblems = (pack) => [
  ...scan('saude (medicacao)', MEDICATION, pack),
  ...scan('saude (dieta)', DIET, pack),
];

const itemsById = (pack) => {
  const map = new Map();
  for (const list of ['tips', 'concepts', 'videos']) {
    for (const item of pack?.[list] ?? []) map.set(`${list}:${item.id}`, item);
  }
  return map;
};

/** A curadoria e identificada: so "Luna". Ninguem pode assinar como profissional de saude. */
export function reviewerProblems(pack) {
  const problems = [];
  for (const [key, item] of itemsById(pack)) {
    if (item.reviewedBy !== undefined && item.reviewedBy !== 'Luna') {
      problems.push(`revisor: ${key}: reviewedBy deve ser "Luna"`);
    }
  }
  return problems;
}

/** "Aprovado por voce" so aparece se o Caio aprovou: o id precisa estar em _control.userApprovedIds. */
export function userApprovalProblems(pack, previous, control) {
  const approved = new Set(control?.userApprovedIds ?? []);
  const before = itemsById(previous);
  const problems = [];
  for (const [key, item] of itemsById(pack)) {
    if (item.approvedByUserAt === undefined) continue;
    const had = before.get(key)?.approvedByUserAt === item.approvedByUserAt;
    if (!had && !approved.has(item.id)) {
      problems.push(`aprovacao do usuario: ${key}: approvedByUserAt sem registro em userApprovedIds`);
    }
  }
  return problems;
}

/** Limites por rodada: impede apagao ou reescrita em massa. */
export function changeSizeProblems(pack, previous) {
  const before = itemsById(previous);
  const after = itemsById(pack);
  let removed = 0;
  let changed = 0;
  for (const [key, item] of before) {
    if (!after.has(key)) removed += 1;
    else if (JSON.stringify(after.get(key)) !== JSON.stringify(item)) changed += 1;
  }
  let added = 0;
  for (const key of after.keys()) if (!before.has(key)) added += 1;
  const problems = [];
  if (added + changed > MAX_ADDED_OR_CHANGED) {
    problems.push(
      `mudanca grande demais: ${added + changed} itens novos ou alterados (limite ${MAX_ADDED_OR_CHANGED})`,
    );
  }
  if (removed > MAX_REMOVED) problems.push(`remocao grande demais: ${removed} itens (limite ${MAX_REMOVED})`);
  if (before.size >= 4 && removed / before.size > MAX_REMOVED_FRACTION) {
    problems.push(`remocao de mais de ${MAX_REMOVED_FRACTION * 100}% do conteudo`);
  }
  return problems;
}

/** Luna so escreve em content/<area>.json e content/_control.json. Nada de codigo, validador ou workflow. */
export function pathProblems(paths) {
  const ok = new RegExp(`^content/(?:${AREAS.join('|')}\\.json|_control\\.json|_heartbeat\\.json)$`);
  return paths
    .filter((p) => !ok.test(p) && !p.startsWith('status/'))
    .map((p) => `caminho nao permitido: ${p}`);
}

/** Texto do parser que significa "item descartado": na publicacao isso e erro, nao aviso. */
export const isDroppedIssue = (issue) => /invalid|inv[aá]lid|repetido|desconhecid/i.test(issue);

/** Batimento da tarefa agendada da Luna: prova de que ela rodou e o que decidiu. */
export function heartbeatProblems(heartbeat) {
  if (heartbeat === null || heartbeat === undefined) return [];
  const problems = [];
  if (heartbeat.schema !== 'atlas-content-heartbeat-v1') problems.push('batimento: schema desconhecido');
  if (typeof heartbeat.lastRunAt !== 'string' || Number.isNaN(Date.parse(heartbeat.lastRunAt))) {
    problems.push('batimento: lastRunAt invalido');
  }
  if (typeof heartbeat.summary !== 'string' || heartbeat.summary.length === 0 || heartbeat.summary.length > 300) {
    problems.push('batimento: summary deve ter de 1 a 300 caracteres');
  }
  if (typeof heartbeat.changed !== 'boolean') problems.push('batimento: changed deve ser verdadeiro ou falso');
  return problems;
}
