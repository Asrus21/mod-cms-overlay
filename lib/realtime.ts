import Pusher from "pusher";

// Camada de tempo real (secao 2.4). Um unico canal por overlay/canal da
// live, com eventos distintos para nao haver ambiguidade:
//  - media:show   -> adiciona/atualiza UMA midia na tela (varias coexistem)
//  - media:move   -> atualiza posicao/escala/som de UMA midia em tempo real
//  - media:remove -> remove UMA midia da tela
//  - media:clear  -> limpa TODAS as midias
// Cada midia colocada tem um `itemId` unico (varias instancias, sem limite;
// ate a mesma midia pode aparecer mais de uma vez).
//
// O overlay e por STREAMER: um canal por streamer (`overlay-<streamer>`). Todos
// os mods que atendem aquele streamer publicam no mesmo canal, e o OBS do
// streamer assina esse canal (link permanente /overlay/<streamer>). Cada item
// guarda o `owner` (mod que colocou) para a mesa ser individual por mod e para
// o "limpar" remover so os itens do proprio mod.
export const OVERLAY_CHANNEL_PREFIX = "overlay-";

export function overlayChannel(streamer: string): string {
  return `${OVERLAY_CHANNEL_PREFIX}${streamer}`;
}

export const EVENT_SHOW = "media:show";
export const EVENT_MOVE = "media:move";
export const EVENT_REMOVE = "media:remove";
export const EVENT_CLEAR = "media:clear";

export type ShowMediaPayload = {
  itemId: string;
  owner: string; // mod que colocou (para mesa por mod e clear por mod)
  mediaId: string;
  url: string;
  type: "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";
  text?: string; // conteudo quando type = TEXT
  durationMs: number;
  triggeredAt: number;
  // Posicao/escala iniciais (normalizadas). x,y sao fracoes 0..1 do tamanho
  // do overlay (centro da midia); scale = largura (fracao da largura da tela).
  // scaleY = altura (fracao da altura da tela); ausente/nulo = altura natural
  // (mantem a proporcao original, sem distorcer). sticky = fica na tela ate um
  // clear/novo show (nao some sozinho) — usado pela mesa.
  x?: number;
  y?: number;
  scale?: number;
  scaleY?: number | null;
  // volume do audio/video (0..1) e mudo — refletidos no overlay do OBS.
  volume?: number;
  muted?: boolean;
  // oculto: nao mostra a midia no overlay nem toca o som (fica "guardada" na
  // mesa, pode ser reexibida).
  hidden?: boolean;
  sticky?: boolean;
};

// Atualizacao de posicao/escala/som em tempo real enquanto o mod controla a
// mesa. scaleY nulo/ausente = altura natural (proporcao original).
export type MovePayload = {
  itemId: string;
  mediaId: string;
  x: number;
  y: number;
  scale: number;
  scaleY?: number | null;
  volume?: number;
  muted?: boolean;
  hidden?: boolean;
  triggeredAt: number;
};

export type RemovePayload = {
  itemId: string;
  triggeredAt: number;
};

export type ClearPayload = {
  // Limpa apenas os itens deste mod (mesa individual). Ausente = limpa tudo.
  owner?: string;
  triggeredAt: number;
};

let pusherServer: Pusher | null = null;

function getPusherServer(): Pusher {
  const appId = process.env.PUSHER_APP_ID || "";
  const key = process.env.PUSHER_KEY || "";
  const secret = process.env.PUSHER_SECRET || "";
  const cluster = process.env.PUSHER_CLUSTER || "";

  // Erro claro quando as credenciais de SERVIDOR do Pusher faltam. Atencao:
  // o "Conectado" verde no painel usa so NEXT_PUBLIC_PUSHER_KEY/CLUSTER
  // (lado navegador). Publicar exige tambem APP_ID e SECRET aqui no servidor.
  if (!appId || !key || !secret || !cluster) {
    const faltando = [
      !appId && "PUSHER_APP_ID",
      !key && "PUSHER_KEY",
      !secret && "PUSHER_SECRET",
      !cluster && "PUSHER_CLUSTER",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Tempo real (Pusher) nao configurado no servidor. Faltando: ${faltando}. Defina no projeto Vercel e refaca o deploy.`
    );
  }

  if (!pusherServer) {
    pusherServer = new Pusher({ appId, key, secret, cluster, useTLS: true });
  }
  return pusherServer;
}

// Dispara no Pusher e, se ele responder erro (ex.: HTTP 400), levanta uma
// mensagem que inclui o CORPO da resposta do Pusher — que diz o motivo real —
// mais uma dica. Um 400/401 com as 4 variaveis presentes costuma ser
// credencial ERRADA: cluster diferente do app, ou secret/app_id trocados.
async function safeTrigger(channel: string, event: string, data: unknown) {
  try {
    await getPusherServer().trigger(channel, event, data);
  } catch (err) {
    const e = err as { message?: string; status?: number; body?: unknown };
    const body =
      e.body && typeof e.body !== "object"
        ? String(e.body)
        : e.body
        ? JSON.stringify(e.body)
        : "";
    const status = e.status ? `HTTP ${e.status}` : e.message || "erro";
    throw new Error(
      `Pusher recusou o envio (${status})${body ? `: ${body}` : ""}. ` +
        `Verifique se PUSHER_CLUSTER é o MESMO cluster do app no Pusher e se ` +
        `PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET são desse mesmo app.`
    );
  }
}

export async function publishShowMedia(streamer: string, payload: ShowMediaPayload) {
  await safeTrigger(overlayChannel(streamer), EVENT_SHOW, payload);
}

export async function publishMove(streamer: string, payload: MovePayload) {
  await safeTrigger(overlayChannel(streamer), EVENT_MOVE, payload);
}

export async function publishRemove(streamer: string, payload: RemovePayload) {
  await safeTrigger(overlayChannel(streamer), EVENT_REMOVE, payload);
}

export async function publishClear(streamer: string, payload: ClearPayload) {
  await safeTrigger(overlayChannel(streamer), EVENT_CLEAR, payload);
}
