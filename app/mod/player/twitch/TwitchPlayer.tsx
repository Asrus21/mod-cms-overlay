"use client";

import { useEffect, useRef, useState } from "react";
import {
  escolherQualidade,
  type QualidadeDisponivel,
  type QualidadeId,
} from "@/lib/twitch-player";

// O player da Twitch, carregado pela API JS do embed — e nao por um iframe
// direto do player.twitch.tv — porque so a API JS deixa escolher a qualidade
// (setQuality). Ver o comentario de lib/twitch-player.ts.

const SCRIPT = "https://player.twitch.tv/js/embed/v1.js";

// Tipos minimos do que usamos da API do embed (ela nao tem @types).
type PlayerTwitch = {
  getQualities(): QualidadeDisponivel[];
  getQuality(): string;
  setQuality(group: string): void;
  addEventListener(evento: string, fn: () => void): void;
  setMuted(m: boolean): void;
};
declare global {
  interface Window {
    Twitch?: {
      Player: (new (alvo: string | HTMLElement, opcoes: Record<string, unknown>) => PlayerTwitch) & {
        PLAYING: string;
        READY: string;
      };
    };
  }
}

// Carrega o script do embed uma vez so, mesmo com varios players na tela.
let carregando: Promise<void> | null = null;
function carregarScript(): Promise<void> {
  if (window.Twitch?.Player) return Promise.resolve();
  if (carregando) return carregando;
  carregando = new Promise<void>((ok, erro) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      carregando = null; // deixa tentar de novo numa proxima montagem
      erro(new Error("Nao foi possivel carregar o player da Twitch"));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

export function TwitchPlayer({
  canal,
  qualidade,
  comAudio,
}: {
  canal: string;
  qualidade: QualidadeId;
  comAudio: boolean;
}) {
  const alvo = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    let player: PlayerTwitch | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // CUIDADO AO MEXER AQUI: setQuality REINICIA a reproducao, e todo reinicio
    // dispara PLAYING de novo. Chamar setQuality a cada PLAYING, como se fazia
    // antes, se alimenta sozinho: o video reinicia sem parar e nunca chega a
    // carregar. Medido com a API dublada: ~600 mil chamadas em 8 segundos.
    //
    // Por isso duas travas:
    //  - nao mexer quando o player JA esta na qualidade pedida (o caso normal
    //    depois da primeira vez, que zera as chamadas em regime);
    //  - e um intervalo minimo entre duas trocas, para um reinicio de verdade
    //    da live ainda poder ser corrigido, mas nunca virar laco.
    const INTERVALO_MIN_MS = 10_000;
    const MAX_ESPERAS = 12;
    let ultimaTroca = 0;
    let esperas = 0;

    const aplicar = () => {
      if (!vivo || !player) return;

      let grupo: string | null = null;
      try {
        grupo = escolherQualidade(qualidade, player.getQualities());
      } catch {
        grupo = null;
      }

      // A lista de qualidades so fica pronta um pouco depois de comecar a
      // tocar. Enquanto nao vier, tenta de novo — com teto, para nao ficar
      // consultando para sempre num canal fora do ar.
      if (!grupo) {
        if (esperas < MAX_ESPERAS) {
          esperas++;
          timers.push(setTimeout(aplicar, 600));
        }
        return;
      }

      // Ja esta no que foi pedido: mexer aqui so reiniciaria o video a toa.
      try {
        if (player.getQuality() === grupo) return;
      } catch {
        /* player sem getQuality: segue para o intervalo minimo abaixo */
      }

      const agora = Date.now();
      if (agora - ultimaTroca < INTERVALO_MIN_MS) return;
      ultimaTroca = agora;
      try {
        player.setQuality(grupo);
      } catch {
        /* o player some entre o evento e a chamada; nada a fazer */
      }
    };

    carregarScript()
      .then(() => {
        if (!vivo || !alvo.current || !window.Twitch?.Player) return;
        player = new window.Twitch.Player(alvo.current, {
          channel: canal,
          // A Twitch exige o dominio que esta embutindo o player. Como esta
          // pagina e nossa e pode ser servida tanto pelo asrus.app quanto pelo
          // dominio do projeto, lemos do proprio navegador.
          parent: [window.location.hostname],
          width: "100%",
          height: "100%",
          autoplay: true,
          // Sem os controles da Twitch: isto e um elemento de overlay, nao um
          // player para alguem operar.
          controls: false,
          // Mudo por padrao: navegador so deixa tocar sozinho sem som, e o
          // audio da propria live entraria em cima do audio do streamer.
          muted: !comAudio,
        });
        player.addEventListener(window.Twitch.Player.PLAYING, aplicar);
        player.addEventListener(window.Twitch.Player.READY, aplicar);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : "Falha no player");
      });

    return () => {
      vivo = false;
      for (const t of timers) clearTimeout(t);
    };
  }, [canal, qualidade, comAudio]);

  if (erro) return <p className="twitch-erro">{erro}</p>;
  return <div className="twitch-alvo" ref={alvo} />;
}
