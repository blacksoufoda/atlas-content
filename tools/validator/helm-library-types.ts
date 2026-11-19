/**
 * HELM Library: short tips with a source, videos with takeaways, and an optional record of what the user used.
 * The content is static and versioned; only `HelmLibraryState` lives on the device. No score, no streak.
 */

/** `approved` is the only status the normal app shows. It needs a human reviewer; code never sets it. */
export type HelmContentStatus = 'draft' | 'reviewed' | 'approved' | 'expired';

/** How much confidence the evidence deserves, in words. "Proven" is never used. */
export type HelmCertainty = 'solid' | 'moderate' | 'limited' | 'common' | 'unassessed';

export const HELM_CERTAINTY_LABEL: Record<HelmCertainty, string> = {
  solid: 'Evidência sólida',
  moderate: 'Evidência moderada',
  limited: 'Evidência limitada',
  common: 'Prática comum, sem estudo próprio',
  unassessed: 'Não avaliada',
};

/** The seven built-in trails. Luna can add more through the content pack, so an id is any slug. */
export type HelmBuiltinTrailId =
  | 'start'
  | 'too_big'
  | 'other_thing'
  | 'uncomfortable'
  | 'priority'
  | 'shame'
  | 'return';
export type HelmTrailId = string;

export type HelmTrail = { id: HelmTrailId; label: string; hint: string };

export type HelmTip = {
  id: string;
  version: number;
  title: string;
  oneLine: string;
  trailId: HelmTrailId;
  /** The if-then plan. The user may rewrite it in their own words. */
  when: { if: string; then: string };
  /** Up to three steps. */
  steps: string[];
  why: {
    text: string;
    certainty: HelmCertainty;
    /** An id from `design-kit/helm-biblioteca-audit/dados/evidencias.json` (E01 to E15), when there is one. */
    evidenceRef?: string;
    sourceUrl?: string;
  };
  /** The limit of the tip and the way to human help. */
  careful: string;
  minutes: number;
  /** Behaviour Change Technique codes (only 1.4, 2.3 and 2.4 were confirmed against the taxonomy). */
  bct?: string[];
  status: HelmContentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Day the user said, in chat, that they approve this item. Separate from the curator's seal. */
  approvedByUserAt?: string;
  /** After this day the tip disappears until someone reviews it again. */
  expiresAt: string;
};

export type HelmVideo = {
  id: string;
  title: string;
  author: string;
  url: string;
  minutes: number;
  language: 'pt' | 'en' | 'other';
  /** What to look for while watching. */
  beforeWatching: string;
  /** Three points written by a person from `takeawaysFrom`. HELM does not watch videos. */
  takeaways: string[];
  takeawaysFrom: string;
  trailIds: HelmTrailId[];
  certainty: HelmCertainty;
  note?: string;
  /** Curation area (01 to 08), when the video comes from the 63-video base. */
  area?: '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08';
  /** Warning that goes with an approved video in a sensitive area. */
  cautions?: string;
  linkVerifiedAt?: string;
  license?: 'unknown' | 'link_only' | 'permitted';
  /** Never picked for the daily queue; only reached by choice. */
  sensitive?: boolean;
  status: HelmContentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Day the user said, in chat, that they approve this item. Separate from the curator's seal. */
  approvedByUserAt?: string;
  expiresAt: string;
};

export type HelmUseResult = 'used' | 'some' | 'no_fit' | 'not_used';

export const HELM_USE_LABEL: Record<HelmUseResult, string> = {
  used: 'Usei',
  some: 'Usei um pouco',
  no_fit: 'Não coube hoje',
  not_used: 'Não usei',
};

/** One self-report. A day with no record is not a "no". */
export type HelmTipUse = {
  id: string;
  /** A library tip id, or a user item id. */
  itemId: string;
  at: string;
  result: HelmUseResult;
  note?: string;
};

export type HelmVideoNote = {
  videoId: string;
  at: string;
  /** The user's own sentence, written before the takeaways are revealed. */
  mine: string;
  /** Days on which the video comes back to the Library (3 and 14 days). Never a notification. */
  revisitOn: string[];
  revealedAt?: string;
};

export type HelmUserItem = {
  id: string;
  kind: 'tip' | 'video';
  title: string;
  text?: string;
  url?: string;
  from: 'me' | 'therapist';
  at: string;
};

export type HelmLibraryThemeId =
  | 'autocritica'
  | 'pensamentos'
  | 'ruminacao'
  | 'gratidao'
  | 'acao'
  | 'pausa'
  | 'foco'
  | 'rotina';

export type HelmLibraryTheme = {
  id: HelmLibraryThemeId;
  label: string;
  subtitle: string;
  trailId: HelmTrailId;
};

export type HelmConcept = {
  id: string;
  title: string;
  subtitle: string;
  themeId: HelmLibraryThemeId;
  trailId: HelmTrailId;
  categoryLabel: string;
  readingMinutes: number;
  summary: string;
  explanation: string[];
  practicalApplication: {
    when: string;
    step: string;
  };
  limits: string;
  certainty: HelmCertainty;
  sourceLabel: string;
  sourceUrl?: string;
  relatedConceptIds: string[];
  relatedTipIds: string[];
  practiceId?: string;
  offlineAvailable: boolean;
  status: HelmContentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedByUserAt?: string;
  expiresAt: string;
};

export type HelmLibraryState = {
  uses: HelmTipUse[];
  videoNotes: HelmVideoNote[];
  userItems: HelmUserItem[];
  /** Tips the user asked not to see as "tip of the day" again. */
  dismissedTipIds: string[];
  /** The "other tip" taps of one day (at most three). */
  skips: { day: string; count: number };
  /** Obstacles the user chose in Unlock. Only used to pick the daily tip, never shown as a score. */
  picks: { trailId: HelmTrailId; at: string }[];
  /** Hides the daily tip card on Today. */
  hideTodayCard: boolean;
  /** Day (local, YYYY-MM-DD) on which the user closed the daily tip card with the X. It returns the next day. */
  hiddenTodayOn?: string;
  /** Shows drafts to reviewers. Off by default and always labelled. */
  reviewMode: boolean;
  /** Saved item IDs (tips, concepts, videos, or user items) in "Minha coleção". Optional for backwards compatibility. */
  savedIds?: string[];
  /** Honest offline filter for Library: hides external video links and highlights local offline content. */
  offlineMode?: boolean;
  /** Items the user chose not to see again (any tip, concept or video). A one-tap veto over reviewed content. */
  hiddenIds?: string[];
};

export function emptyLibraryState(): HelmLibraryState {
  return {
    uses: [],
    videoNotes: [],
    userItems: [],
    dismissedTipIds: [],
    skips: { day: '', count: 0 },
    picks: [],
    hideTodayCard: false,
    reviewMode: false,
  };
}
