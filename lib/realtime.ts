import Pusher from "pusher";

// Camada de tempo real (secao 2.4). Um unico canal por overlay/canal da
// live, com dois tipos de evento distintos para nao haver ambiguidade
// entre "mostrar" e "limpar" (secao 4).
export const OVERLAY_CHANNEL = "overlay";
export const EVENT_SHOW = "media:show";
export const EVENT_CLEAR = "media:clear";

export type ShowMediaPayload = {
  mediaId: string;
  url: string;
  type: "IMAGE" | "GIF" | "VIDEO" | "AUDIO";
  durationMs: number;
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

export async function publishClear(payload: ClearPayload) {
  await getPusherServer().trigger(OVERLAY_CHANNEL, EVENT_CLEAR, payload);
}
