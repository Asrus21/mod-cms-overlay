import Pusher from "pusher";

// Camada de tempo real (secao 2.4). Um unico canal por overlay/canal da
// live, com eventos distintos para nao haver ambiguidade:
//  - media:show  -> coloca/troca a midia na tela
//  - media:move  -> atualiza posicao/escala em tempo real (mesa de controle)
//  - media:clear -> limpa a tela
export const OVERLAY_CHANNEL = "overlay";
export const EVENT_SHOW = "media:show";
export const EVENT_MOVE = "media:move";
export const EVENT_CLEAR = "media:clear";

export type ShowMediaPayload = {
  mediaId: string;
  url: string;
  type: "IMAGE" | "GIF" | "VIDEO" | "AUDIO";
  durationMs: number;
  triggeredAt: number;
  // Posicao/escala iniciais (normalizadas). x,y sao fracoes 0..1 do tamanho
  // do overlay (centro da midia); scale e multiplicador. sticky = fica na
  // tela ate um clear/novo show (nao some sozinho) — usado pela mesa.
  x?: number;
  y?: number;
  scale?: number;
  sticky?: boolean;
};

// Atualizacao de posicao/escala em tempo real enquanto o mod arrasta o mouse.
export type MovePayload = {
  mediaId: string;
  x: number;
  y: number;
  scale: number;
  triggeredAt: number;
};

export type ClearPayload = {
  triggeredAt: number;
};

let pusherServer: Pusher | null = null;

function getPusherServer(): Pusher {
  if (!pusherServer) {
    pusherServer = new Pusher({
      appId: process.env.PUSHER_APP_ID || "",
      key: process.env.PUSHER_KEY || "",
      secret: process.env.PUSHER_SECRET || "",
      cluster: process.env.PUSHER_CLUSTER || "us2",
      useTLS: true,
    });
  }
  return pusherServer;
}

export async function publishShowMedia(payload: ShowMediaPayload) {
  await getPusherServer().trigger(OVERLAY_CHANNEL, EVENT_SHOW, payload);
}

export async function publishMove(payload: MovePayload) {
  await getPusherServer().trigger(OVERLAY_CHANNEL, EVENT_MOVE, payload);
}

export async function publishClear(payload: ClearPayload) {
  await getPusherServer().trigger(OVERLAY_CHANNEL, EVENT_CLEAR, payload);
}
