/**
 * Contrato da curadoria verificada de TCC/vídeos do HELM. Domínio puro, sem conteúdo.
 *
 * Fonte: Notion "HELM — Base de Conhecimento | Curadoria Psicológica e Comportamental (63 vídeos)".
 * Essa página se declara PROPOSTA: links não validados, direitos não confirmados e fichas de
 * takeaways ainda não produzidas. Por isso `HELM_CURATED_SOURCES` começa vazio e NADA daqui aparece
 * no app até que um revisor identificado (pessoa ou agente) confira e aprove cada entrada.
 *
 * Os campos espelham o "esquema sugerido" da página (area, prioridade, titulo, autor, url,
 * data_verificacao, status_licenca, conceitos, limites, contraindicacoes_ou_alertas, versao,
 * fonte_do_resumo). A trava `curationBlockers` lista o que ainda impede uma entrada de aparecer.
 */

export type HelmCurationArea = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08';
export type HelmCurationPriority = 'essential' | 'complementary';
/** `link_only`: só abrir o link ao toque. `permitted`: há permissão explícita para resumo/uso maior. */
export type HelmCurationLicense = 'unknown' | 'link_only' | 'permitted';
export type HelmCurationSummarySource = 'unreviewed' | 'human_reviewed' | 'agent_reviewed';

export type HelmCuratedSource = {
  id: string;
  area: HelmCurationArea;
  priority: HelmCurationPriority;
  title: string;
  author: string;
  url: string;
  /** Data (AAAA-MM-DD) em que o revisor abriu o link e conferiu título/autor. */
  linkVerifiedAt?: string;
  license: HelmCurationLicense;
  /** Takeaways revisados por pessoa ou agente identificado; nunca transcrição integral. */
  takeaways: readonly string[];
  summarySource: HelmCurationSummarySource;
  /** Limites do conteúdo (o que o vídeo não prova). Obrigatório. */
  limits: string;
  /** Alertas/contraindicações. Obrigatório nas áreas sensíveis. */
  cautions?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  clinicalLanguageReviewed?: boolean;
  version: number;
};

/** Áreas em que um resumo mal escrito pode virar rótulo ou cobrança: exigem `cautions`. */
export const SENSITIVE_CURATION_AREAS: readonly HelmCurationArea[] = ['01', '04', '05', '07'];
export const CURATION_LINK_MAX_AGE_DAYS = 180;
export const MAX_TAKEAWAYS = 3;
export const MAX_TAKEAWAY_CHARS = 200;

/** Vazio de propósito: a curadoria ainda não foi verificada nem aprovada. */
export const HELM_CURATED_SOURCES: readonly HelmCuratedSource[] = [];

const YOUTUBE_URL = /^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}$/;
const CLINICAL_CLAIMS =
  /diagnostic|tratamento|\bcura\b|sintoma|transtorno|voce tem\b|medicacao|depressao|ansiedade cronica|sofre de\b|terapia resolve/i;

export function hasClinicalClaim(value: string): boolean {
  return CLINICAL_CLAIMS.test(value.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' '));
}

function ageInDays(day: string, now: Date): number {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day)
    return Number.POSITIVE_INFINITY;
  const age = (now.getTime() - t) / 86_400_000;
  return age < 0 ? Number.POSITIVE_INFINITY : age;
}

/** Motivos pelos quais a entrada ainda NÃO pode aparecer. Lista vazia = publicável. */
export function curationBlockers(source: HelmCuratedSource, now: Date): string[] {
  const out: string[] = [];
  if (!YOUTUBE_URL.test(source.url)) out.push('link fora do padrão https://youtube.com/watch?v=…');
  if (!source.linkVerifiedAt) out.push('link não verificado por pessoa');
  else if (ageInDays(source.linkVerifiedAt, now) > CURATION_LINK_MAX_AGE_DAYS) {
    out.push('verificação do link vencida');
  }
  if (source.license !== 'link_only' && source.license !== 'permitted')
    out.push('direitos de uso não confirmados');
  if (source.summarySource !== 'human_reviewed' && source.summarySource !== 'agent_reviewed')
    out.push('resumo não revisado por pessoa ou agente');
  if (source.clinicalLanguageReviewed !== true) out.push('revisão de linguagem clínica pendente');
  if (source.takeaways.length === 0) out.push('sem takeaways');
  if (source.takeaways.length > MAX_TAKEAWAYS) out.push(`mais de ${MAX_TAKEAWAYS} takeaways`);
  if (source.takeaways.some((t) => t.trim().length === 0 || t.length > MAX_TAKEAWAY_CHARS)) {
    out.push(`takeaway vazio ou acima de ${MAX_TAKEAWAY_CHARS} caracteres`);
  }
  if ([source.title, ...source.takeaways].some(hasClinicalClaim)) {
    out.push('takeaway com linguagem clínica (diagnóstico, tratamento, sintoma…)');
  }
  if (source.limits.trim().length === 0) out.push('sem limites do conteúdo');
  if (SENSITIVE_CURATION_AREAS.includes(source.area) && !(source.cautions ?? '').trim()) {
    out.push('área sensível sem alertas');
  }
  if (
    !source.reviewedBy?.trim() ||
    !source.reviewedAt ||
    !Number.isFinite(ageInDays(source.reviewedAt, now))
  )
    out.push('sem revisor e data de revisão válida');
  return out;
}

/** Só o que passa em todas as travas. Nunca inclui nada sem revisão identificada. */
export function publishableCuratedSources(
  sources: readonly HelmCuratedSource[],
  now: Date,
): HelmCuratedSource[] {
  return sources.filter((s) => curationBlockers(s, now).length === 0);
}
