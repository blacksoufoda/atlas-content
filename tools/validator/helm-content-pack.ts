import { hasClinicalClaim } from './helm-curation';
import type {
  HelmCertainty,
  HelmConcept,
  HelmContentStatus,
  HelmLibraryThemeId,
  HelmTip,
  HelmTrail,
  HelmTrailId,
  HelmVideo,
} from './helm-library-types';

/**
 * Content pack: tips, concepts, videos and a daily queue that Luna writes outside the app (a JSON file
 * on Drive). The app only reads it. Every item is checked here with the same locks the bundled content
 * obeys; an item that fails a lock for `approved` is kept as a draft (never shown outside review mode),
 * and an item that is malformed is dropped. Nothing in a pack can carry a personal record, because the
 * app never sends one.
 */

export const CONTENT_PACK_SCHEMA = 'atlas-helm-content-pack-v1';
export const CONTENT_PACK_MAX_CHARS = 400_000;
const MAX_ITEMS = 300;

const BUILTIN_TRAILS: readonly HelmTrailId[] = [
  'start',
  'too_big',
  'other_thing',
  'uncomfortable',
  'priority',
  'shame',
  'return',
];
const MAX_TRAILS = 20;
const THEMES: readonly HelmLibraryThemeId[] = [
  'autocritica',
  'pensamentos',
  'ruminacao',
  'gratidao',
  'acao',
  'pausa',
  'foco',
  'rotina',
];
const CERTAINTIES: readonly HelmCertainty[] = [
  'solid',
  'moderate',
  'limited',
  'common',
  'unassessed',
];
const STATUSES: readonly HelmContentStatus[] = ['draft', 'reviewed', 'approved', 'expired'];
/** Areas where a careless summary can become a label or a demand: an approved video needs `cautions`. */
const SENSITIVE_AREAS = ['01', '04', '05', '07'];

export type HelmContentPack = {
  version: number;
  /** Extra trails (situations) Luna adds on top of the seven built-in ones. */
  trails: HelmTrail[];
  generatedAt: string;
  tips: HelmTip[];
  concepts: HelmConcept[];
  videos: HelmVideo[];
  /** Luna's pick for a given day. A day with no entry falls back to the local rule. */
  dailyQueue: { date: string; tipId: string }[];
  /** Ids of bundled items that Luna withdrew. */
  retired: string[];
};

export type ParsedContentPack =
  | { ok: true; pack: HelmContentPack; issues: string[] }
  | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const ID = /^[a-z0-9][a-z0-9-]{2,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const YOUTUBE = /^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}$/;

function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}
const str = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 0 && clean.length <= max ? clean : null;
};
const list = (value: unknown, minItems: number, maxItems: number, maxLen: number) => {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) return null;
  const out = value.map((entry) => str(entry, maxLen));
  return out.every((entry): entry is string => entry !== null) ? out : null;
};
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;
const httpsUrl = (value: unknown): string | null => {
  const url = str(value, 600);
  return url && /^https:\/\/[^\s]+$/.test(url) ? url : null;
};
const optional = <T>(value: unknown, parse: (v: unknown) => T | null): T | undefined | null =>
  value === undefined ? undefined : parse(value);

type Base = {
  status: HelmContentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedByUserAt?: string;
  expiresAt: string;
};

function readBase(o: Obj): Base | null {
  const status = oneOf(o.status, STATUSES);
  if (!status || !isDay(o.expiresAt)) return null;
  const reviewedBy = optional(o.reviewedBy, (v) => str(v, 60));
  const reviewedAt =
    o.reviewedAt === undefined ? undefined : isDay(o.reviewedAt) ? o.reviewedAt : null;
  const approvedByUserAt =
    o.approvedByUserAt === undefined
      ? undefined
      : isDay(o.approvedByUserAt)
        ? o.approvedByUserAt
        : null;
  if (reviewedBy === null || reviewedAt === null || approvedByUserAt === null) return null;
  return {
    status,
    expiresAt: o.expiresAt,
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(approvedByUserAt ? { approvedByUserAt } : {}),
  };
}

/** `approved` needs an identified reviewer, a date, an unexpired item and no clinical language. */
function gate(base: Base, texts: string[], today: string, extra: string[] = []): string | null {
  if (base.status !== 'approved') return null;
  const problems = [...extra];
  if (!base.reviewedBy || !base.reviewedAt) problems.push('sem revisor e data');
  if (base.expiresAt < today) problems.push('vencido');
  if (texts.some(hasClinicalClaim)) problems.push('linguagem clínica');
  return problems.length ? problems.join(', ') : null;
}

function readTip(o: Obj, today: string, trails: readonly HelmTrailId[]): { tip: HelmTip; note?: string } | null {
  const base = readBase(o);
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
  const title = str(o.title, 80);
  const oneLine = str(o.oneLine, 160);
  const trailId = oneOf(o.trailId, trails);
  const when = isObj(o.when) ? { if: str(o.when.if, 160), then: str(o.when.then, 160) } : null;
  const steps = list(o.steps, 1, 3, 160);
  const why = isObj(o.why) ? o.why : null;
  const whyText = why ? str(why.text, 400) : null;
  const certainty = why ? oneOf(why.certainty, CERTAINTIES) : null;
  const careful = str(o.careful, 240);
  const minutes =
    typeof o.minutes === 'number' && o.minutes >= 1 && o.minutes <= 30 ? o.minutes : null;
  if (!base || !id || !title || !oneLine || !trailId || !steps || !whyText || !certainty)
    return null;
  if (!when?.if || !when.then || !careful || minutes === null) return null;
  const sourceUrl = why ? optional(why.sourceUrl, httpsUrl) : undefined;
  if (sourceUrl === null) return null;
  const evidenceRef = why ? optional(why.evidenceRef, (v) => str(v, 20)) : undefined;
  const bct = o.bct === undefined ? undefined : list(o.bct, 0, 6, 12);
  if (bct === null) return null;
  const problem = gate(base, [title, oneLine, when.if, when.then, ...steps, whyText], today);
  const tip: HelmTip = {
    id,
    version: typeof o.version === 'number' && o.version >= 1 ? Math.floor(o.version) : 1,
    title,
    oneLine,
    trailId,
    when: { if: when.if, then: when.then },
    steps,
    why: {
      text: whyText,
      certainty,
      ...(evidenceRef ? { evidenceRef } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    },
    careful,
    minutes,
    ...(bct ? { bct } : {}),
    ...base,
    ...(problem ? { status: 'draft' as const } : {}),
  };
  return { tip, ...(problem ? { note: problem } : {}) };
}

function readConcept(o: Obj, today: string, trails: readonly HelmTrailId[]): { concept: HelmConcept; note?: string } | null {
  const base = readBase(o);
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
  const title = str(o.title, 80);
  const subtitle = str(o.subtitle, 160);
  const themeId = oneOf(o.themeId, THEMES);
  const trailId = oneOf(o.trailId, trails);
  const categoryLabel = str(o.categoryLabel, 40);
  const summary = str(o.summary, 300);
  const explanation = list(o.explanation, 1, 6, 500);
  const app = isObj(o.practicalApplication) ? o.practicalApplication : null;
  const appWhen = app ? str(app.when, 200) : null;
  const appStep = app ? str(app.step, 200) : null;
  const limits = str(o.limits, 300);
  const certainty = oneOf(o.certainty, CERTAINTIES);
  const sourceLabel = str(o.sourceLabel, 120);
  const sourceUrl = optional(o.sourceUrl, httpsUrl);
  const readingMinutes =
    typeof o.readingMinutes === 'number' && o.readingMinutes >= 1 && o.readingMinutes <= 30
      ? o.readingMinutes
      : null;
  const relatedConceptIds =
    o.relatedConceptIds === undefined ? [] : list(o.relatedConceptIds, 0, 12, 61);
  const relatedTipIds = o.relatedTipIds === undefined ? [] : list(o.relatedTipIds, 0, 12, 61);
  const practiceId = optional(o.practiceId, (v) => str(v, 60));
  if (!base || !id || !title || !subtitle || !themeId || !trailId || !categoryLabel) return null;
  if (!summary || !explanation || !appWhen || !appStep || !limits || !certainty) return null;
  if (!sourceLabel || sourceUrl === null || readingMinutes === null) return null;
  if (!relatedConceptIds || !relatedTipIds || practiceId === null) return null;
  const problem = gate(base, [title, summary, ...explanation, appStep], today);
  const concept: HelmConcept = {
    id,
    title,
    subtitle,
    themeId,
    trailId,
    categoryLabel,
    readingMinutes,
    summary,
    explanation,
    practicalApplication: { when: appWhen, step: appStep },
    limits,
    certainty,
    sourceLabel,
    ...(sourceUrl ? { sourceUrl } : {}),
    relatedConceptIds,
    relatedTipIds,
    ...(practiceId ? { practiceId } : {}),
    offlineAvailable: o.offlineAvailable !== false,
    ...base,
    ...(problem ? { status: 'draft' as const } : {}),
  };
  return { concept, ...(problem ? { note: problem } : {}) };
}

function readVideo(o: Obj, today: string, trails: readonly HelmTrailId[]): { video: HelmVideo; note?: string } | null {
  const base = readBase(o);
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
  const title = str(o.title, 140);
  const author = str(o.author, 80);
  const url = typeof o.url === 'string' && YOUTUBE.test(o.url) ? o.url : null;
  const minutes =
    typeof o.minutes === 'number' && o.minutes >= 1 && o.minutes <= 240 ? o.minutes : null;
  const language = oneOf(o.language, ['pt', 'en', 'other'] as const);
  const beforeWatching = str(o.beforeWatching, 240);
  const takeaways = list(o.takeaways, 1, 3, 200);
  const takeawaysFrom = httpsUrl(o.takeawaysFrom);
  const trailIds = Array.isArray(o.trailIds)
    ? o.trailIds.map((t) => oneOf(t, trails)).filter((t): t is HelmTrailId => t !== null)
    : [];
  const certainty = oneOf(o.certainty, CERTAINTIES);
  const note = optional(o.note, (v) => str(v, 240));
  const area = optional(o.area, (v) =>
    oneOf(v, ['01', '02', '03', '04', '05', '06', '07', '08'] as const),
  );
  const cautions = optional(o.cautions, (v) => str(v, 300));
  const linkVerifiedAt =
    o.linkVerifiedAt === undefined ? undefined : isDay(o.linkVerifiedAt) ? o.linkVerifiedAt : null;
  const license = optional(o.license, (v) =>
    oneOf(v, ['unknown', 'link_only', 'permitted'] as const),
  );
  if (!base || !id || !title || !author || !url || minutes === null || !language) return null;
  if (!beforeWatching || !takeaways || !takeawaysFrom || !certainty) return null;
  if (
    note === null ||
    area === null ||
    cautions === null ||
    linkVerifiedAt === null ||
    license === null
  )
    return null;
  const extra: string[] = [];
  if (!linkVerifiedAt) extra.push('link sem verificação');
  if (license !== 'link_only' && license !== 'permitted') extra.push('direitos não confirmados');
  if (area && SENSITIVE_AREAS.includes(area) && !cautions) extra.push('área sensível sem alertas');
  const problem = gate(base, [title, ...takeaways], today, extra);
  const video: HelmVideo = {
    id,
    title,
    author,
    url,
    minutes,
    language,
    beforeWatching,
    takeaways,
    takeawaysFrom,
    trailIds,
    certainty,
    ...(note ? { note } : {}),
    ...(area ? { area } : {}),
    ...(cautions ? { cautions } : {}),
    ...(linkVerifiedAt ? { linkVerifiedAt } : {}),
    ...(license ? { license } : {}),
    ...(o.sensitive === true ? { sensitive: true } : {}),
    ...base,
    ...(problem ? { status: 'draft' as const } : {}),
  };
  return { video, ...(problem ? { note: problem } : {}) };
}

function collect<T>(
  raw: unknown,
  label: string,
  read: (o: Obj) => { value: T; id: string; note?: string } | null,
  issues: string[],
): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push(`${label}: lista inválida`);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  raw.slice(0, MAX_ITEMS).forEach((entry, index) => {
    const got = isObj(entry) ? read(entry) : null;
    if (!got) {
      issues.push(`${label} #${index + 1}: item inválido, ignorado`);
    } else if (seen.has(got.id)) {
      issues.push(`${label} ${got.id}: id repetido, ignorado`);
    } else {
      seen.add(got.id);
      out.push(got.value);
      if (got.note) issues.push(`${label} ${got.id}: ficou como rascunho (${got.note})`);
    }
  });
  return out;
}

/** Extra trails: a slug id (not one of the built-in seven), a short label and a short hint. */
function readTrails(raw: unknown, issues: string[]): HelmTrail[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push('trilhas: lista inválida');
    return [];
  }
  const out: HelmTrail[] = [];
  for (const entry of raw.slice(0, MAX_TRAILS)) {
    const id = isObj(entry) && typeof entry.id === 'string' && ID.test(entry.id) ? entry.id : null;
    const label = isObj(entry) ? str(entry.label, 40) : null;
    const hint = isObj(entry) ? str(entry.hint, 60) : null;
    if (!id || !label || !hint || BUILTIN_TRAILS.includes(id) || out.some((t) => t.id === id)) {
      issues.push('trilha inválida ou repetida, ignorada');
      continue;
    }
    out.push({ id, label, hint });
  }
  return out;
}

export function parseContentPack(text: string, now = new Date()): ParsedContentPack {
  if (text.length > CONTENT_PACK_MAX_CHARS) return { ok: false, error: 'Pacote grande demais.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  if (!isObj(raw) || raw.schema !== CONTENT_PACK_SCHEMA)
    return { ok: false, error: 'Formato de pacote desconhecido.' };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)
    return { ok: false, error: 'Pacote sem versão.' };
  const today = now.toISOString().slice(0, 10);
  const issues: string[] = [];
  const trails = readTrails(raw.trails, issues);
  const trailIds = [...BUILTIN_TRAILS, ...trails.map((tr) => tr.id)];
  const tips = collect(
    raw.tips,
    'dica',
    (o) => {
      const r = readTip(o, today, trailIds);
      return r && { value: r.tip, id: r.tip.id, ...(r.note ? { note: r.note } : {}) };
    },
    issues,
  );
  const concepts = collect(
    raw.concepts,
    'conceito',
    (o) => {
      const r = readConcept(o, today, trailIds);
      return r && { value: r.concept, id: r.concept.id, ...(r.note ? { note: r.note } : {}) };
    },
    issues,
  );
  const videos = collect(
    raw.videos,
    'vídeo',
    (o) => {
      const r = readVideo(o, today, trailIds);
      return r && { value: r.video, id: r.video.id, ...(r.note ? { note: r.note } : {}) };
    },
    issues,
  );
  const queueRaw = Array.isArray(raw.dailyQueue) ? raw.dailyQueue.slice(0, 800) : [];
  const dailyQueue = queueRaw
    .filter(
      (e): e is { date: string; tipId: string } =>
        isObj(e) && isDay(e.date) && typeof e.tipId === 'string' && ID.test(e.tipId),
    )
    .map((e) => ({ date: e.date, tipId: e.tipId }));
  if (queueRaw.length !== dailyQueue.length)
    issues.push('fila diária: entradas inválidas ignoradas');
  const retired = Array.isArray(raw.retired)
    ? raw.retired.filter((v): v is string => typeof v === 'string' && ID.test(v)).slice(0, 200)
    : [];
  return {
    ok: true,
    issues,
    pack: {
      version: raw.version,
      trails,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 40) : '',
      tips,
      concepts,
      videos,
      dailyQueue,
      retired,
    },
  };
}

let active: HelmContentPack | null = null;
let listeners: (() => void)[] = [];

/** The pack the Library merges over the bundled content. Set by the provider; `null` means bundled only. */
export function setActiveContentPack(pack: HelmContentPack | null): void {
  active = pack;
  for (const listener of listeners) listener();
}
export function getActiveContentPack(): HelmContentPack | null {
  return active;
}
export function onContentPackChange(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
