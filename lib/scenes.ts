// Cenas salvas: normalizacao do snapshot dos itens da mesa.
//
// O snapshot vem do navegador, entao nada dele e confiavel: aqui ele e
// reduzido aos campos que a mesa sabe reconstruir, com os numeros presos aos
// mesmos limites que as rotas de disparo usam. Assim aplicar uma cena nunca
// recria um item fora da tela, com escala absurda ou de um tipo desconhecido.
// Logica pura (sem Prisma/React) para poder ser testada direto.

export const MAX_SCENE_ITEMS = 100;

const TIPOS = ["IMAGE", "GIF", "VIDEO", "AUDIO", "TEXT", "EMBED", "WIDGET"] as const;
export type SceneItemType = (typeof TIPOS)[number];

export type SceneItem = {
  mediaId: string | null; // midia da biblioteca; null para texto/widget/embed
  url: string;
  name: string;
  type: SceneItemType;
  text?: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number | null;
  volume: number;
  muted: boolean;
  hidden: boolean;
};

// Mesmos limites das rotas /trigger/show e /trigger/move.
const MIN_SCALE = 0.005;
const MAX_SCALE = 3;
const MAX_TEXTO = 500;
const MAX_NOME = 80;
const MAX_URL = 2000;

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function isTipo(v: unknown): v is SceneItemType {
  return typeof v === "string" && (TIPOS as readonly string[]).includes(v);
}

// Normaliza UM item. Devolve null quando o item nao da para reconstruir (tipo
// desconhecido, ou uma midia da biblioteca sem id).
export function sanitizeSceneItem(raw: unknown): SceneItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isTipo(o.type)) return null;
  const type = o.type;

  const mediaId = typeof o.mediaId === "string" && o.mediaId ? o.mediaId.slice(0, 64) : null;
  const url = str(o.url, MAX_URL);
  const text = str(o.text, MAX_TEXTO);

  // Itens de biblioteca precisam da midia; embed precisa da URL; texto e
  // widget precisam do conteudo. Sem isso o item nasceria quebrado.
  const deBiblioteca = type === "IMAGE" || type === "GIF" || type === "VIDEO" || type === "AUDIO";
  if (deBiblioteca && !mediaId) return null;
  if (type === "EMBED" && !/^https?:\/\//i.test(url)) return null;
  if ((type === "TEXT" || type === "WIDGET") && !text.trim()) return null;

  const scaleYRaw = o.scaleY;
  const scaleY =
    scaleYRaw === null || scaleYRaw === undefined
      ? null
      : clamp(scaleYRaw, MIN_SCALE, MAX_SCALE, MIN_SCALE);

  return {
    mediaId,
    url,
    name: str(o.name, MAX_NOME),
    type,
    ...(text ? { text } : {}),
    x: clamp(o.x, 0, 1, 0.5),
    y: clamp(o.y, 0, 1, 0.5),
    scaleX: clamp(o.scaleX, MIN_SCALE, MAX_SCALE, 0.3),
    scaleY,
    volume: clamp(o.volume, 0, 1, 1),
    muted: Boolean(o.muted),
    hidden: Boolean(o.hidden),
  };
}

// Normaliza a lista inteira, descartando o que nao da para reconstruir.
export function sanitizeSceneItems(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SceneItem[] = [];
  for (const item of raw.slice(0, MAX_SCENE_ITEMS)) {
    const ok = sanitizeSceneItem(item);
    if (ok) out.push(ok);
  }
  return out;
}
