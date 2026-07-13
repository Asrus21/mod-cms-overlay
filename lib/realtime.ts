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
// Cada mod tem a SUA mesa: um canal por mod (`overlay-<slug>`). O painel
// publica no canal do proprio mod e o overlay do OBS assina o canal daquele
// mod (via ?mod=<slug> na URL). Assim a mesa de um mod nao aparece na de outro.
export const OVERLAY_CHANNEL_PREFIX = "overlay-";

export function overlayChannel(owner: string): string {
  return `${OVERLAY_CHANNEL_PREFIX}${owner}`;
}

export const EVENT_SHOW = "media:show";
export const EVENT_MOVE = "media:move";
export const EVENT_REMOVE = "media:remove";
export const EVENT_CLEAR = "media:clear";

export type ShowMediaPayload = {
  itemId: string;
  mediaId: string;
  url: string;
  type: "IMAGE" | "GIF" | "VIDEO" | "AUDIO";
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

export async function publishShowMedia(owner: string, payload: ShowMediaPayload) {
  await safeTrigger(overlayChannel(owner), EVENT_SHOW, payload);
}

export async function publishMove(owner: string, payload: MovePayload) {
  await safeTrigger(overlayChannel(owner), EVENT_MOVE, payload);
}

export async function publishRemove(owner: string, payload: RemovePayload) {
  await safeTrigger(overlayChannel(owner), EVENT_REMOVE, payload);
}

export async function publishClear(owner: string, payload: ClearPayload) {
  await safeTrigger(overlayChannel(owner), EVENT_CLEAR, payload);
}
