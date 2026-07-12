// Integracao com o VDO.Ninja para o feed AO VIVO do mod (camera/tela) entrar
// no OBS do streamer via WebRTC — sem port forwarding, sem expor IP, sem
// instalar nada. O VDO.Ninja cuida da sinalizacao, do STUN/TURN e da midia.
//
// Modelo usado: uma "sala" (room) por canal. Cada mod entra na sala como
// emissor (push) com um id proprio; o OBS usa o link de "scene" da sala, que
// mostra automaticamente qualquer mod que estiver ao vivo naquele momento.
//
// A sala fica protegida por ser um id nao-obvio + senha opcional. Esses
// valores vem de variaveis SO do servidor (VDO_ROOM / VDO_PASSWORD) e sao
// passados como props apenas para o painel autenticado.

const VDO_BASE = "https://vdo.ninja/";

export type VdoConfig = {
  room: string;
  password?: string;
};

// Transforma o nome do mod num id de stream estavel e seguro para URL.
export function streamIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return slug || "mod";
}

function withCommon(params: URLSearchParams, cfg: VdoConfig) {
  params.set("room", cfg.room);
  if (cfg.password) params.set("password", cfg.password);
}

// Link que o MOD abre para transmitir. `screenshare` = compartilhar tela;
// caso contrario, camera + microfone.
export function buildPushUrl(
  cfg: VdoConfig,
  streamId: string,
  opts: { screenshare?: boolean } = {}
): string {
  const params = new URLSearchParams();
  withCommon(params, cfg);
  params.set("push", streamId);
  if (opts.screenshare) params.set("screenshare", "");
  // Sobe direto sem tela de configuracao.
  params.set("autostart", "");
  return `${VDO_BASE}?${params.toString()}`;
}

// Link que o STREAMER coloca como Browser Source no OBS. Mostra qualquer mod
// que estiver ao vivo na sala; fundo transparente para compor na cena.
export function buildSceneUrl(cfg: VdoConfig): string {
  const params = new URLSearchParams();
  withCommon(params, cfg);
  params.set("scene", "");
  params.set("transparent", "");
  return `${VDO_BASE}?${params.toString()}`;
}

// --- Tela do OBS ao vivo como fundo da mesa ---
// O streamer transmite a "Camera Virtual" do OBS (= a tela inteira do OBS)
// pelo VDO.Ninja; os paineis dos mods exibem esse feed como fundo da mesa.
// Usamos push/view por um id de stream unico derivado da sala (que ja e
// secreta), entao nao precisa de room.

// Id de stream do feed da tela do OBS (unico e nao-obvio).
export function obsSceneStreamId(room: string): string {
  return `${streamIdFromName(room)}obsscene`;
}

// Link que o STREAMER abre para transmitir a tela do OBS. Sem autostart de
// proposito: o streamer escolhe "OBS Virtual Camera" na tela do VDO.Ninja.
export function buildObsPushUrl(cfg: VdoConfig): string {
  const params = new URLSearchParams();
  params.set("push", obsSceneStreamId(cfg.room));
  if (cfg.password) params.set("password", cfg.password);
  return `${VDO_BASE}?${params.toString()}`;
}

// Link (embutido em iframe) que os mods usam para VER a tela do OBS ao vivo.
// cleanoutput = sem UI do VDO; noaudio = nao traz o audio do jogo.
export function buildObsViewUrl(cfg: VdoConfig): string {
  const params = new URLSearchParams();
  params.set("view", obsSceneStreamId(cfg.room));
  if (cfg.password) params.set("password", cfg.password);
  params.set("cleanoutput", "");
  params.set("noaudio", "");
  return `${VDO_BASE}?${params.toString()}`;
}
