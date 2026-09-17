// Integracao com a Twitch: login via OAuth (Authorization Code) e chamadas a
// API Helix. Credenciais via env (registrar um app em dev.twitch.tv/console):
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//   TWITCH_REDIRECT_URI  (opcional; senao montamos a partir do host do request)
//
// Escopo usado: user:read:moderated_channels (para listar os canais que a
// pessoa modera). O access token do usuario e usado so no login (nao guardamos).

const AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";
export const TWITCH_SCOPES = "user:read:moderated_channels";

export function twitchConfigured(): boolean {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

function clientId(): string {
  return process.env.TWITCH_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.TWITCH_CLIENT_SECRET || "";
}

export function getAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: TWITCH_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Falha ao trocar o code da Twitch (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Twitch nao retornou access_token");
  return data.access_token;
}

export type TwitchUser = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
};

export async function getCurrentUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId() },
  });
  if (!res.ok) {
    throw new Error(`Falha ao ler o usuario da Twitch (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    data?: { id: string; login: string; display_name: string; profile_image_url: string }[];
  };
  const u = data.data?.[0];
  if (!u) throw new Error("Usuario da Twitch nao encontrado");
  return {
    id: u.id,
    login: u.login,
    displayName: u.display_name || u.login,
    profileImageUrl: u.profile_image_url || "",
  };
}

export type ModeratedChannel = {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
};

// Lista os canais que ESTE usuario (dono do token) modera. Paginado.
export async function getModeratedChannels(
  accessToken: string,
  userId: string
): Promise<ModeratedChannel[]> {
  const out: ModeratedChannel[] = [];
  let cursor: string | undefined;
  // Limite de seguranca: no maximo ~10 paginas (1000 canais).
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({ user_id: userId, first: "100" });
    if (cursor) params.set("after", cursor);
    const res = await fetch(`${HELIX}/moderation/channels?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId() },
    });
    if (!res.ok) {
      throw new Error(`Falha ao listar canais moderados (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      data?: { broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }[];
      pagination?: { cursor?: string };
    };
    for (const c of data.data || []) {
      out.push({
        broadcasterId: c.broadcaster_id,
        broadcasterLogin: c.broadcaster_login,
        broadcasterName: c.broadcaster_name,
      });
    }
    cursor = data.pagination?.cursor;
    if (!cursor) break;
  }
  return out;
}

// --- Token de aplicativo (client credentials) --------------------------
//
// Usado para consultas que nao sao de ninguem em particular: o id de um canal
// e os emotes dele. Nao serve para nada que dependa do usuario logado.
//
// O token da Twitch dura ~60 dias, entao guardamos em memoria e so pedimos
// outro perto de expirar. Em serverless o processo morre a qualquer momento e
// o cache simplesmente comeca vazio de novo — o que custa uma chamada a mais,
// nao um erro.
let tokenApp: { valor: string; expiraEm: number } | null = null;

export async function getAppToken(): Promise<string> {
  const agora = Date.now();
  if (tokenApp && tokenApp.expiraEm > agora + 60_000) return tokenApp.valor;
  if (!twitchConfigured()) {
    throw new Error("Twitch nao configurada no servidor (TWITCH_CLIENT_ID/SECRET).");
  }
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "client_credentials",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Falha ao obter token de aplicativo da Twitch (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Twitch nao devolveu token de aplicativo");
  tokenApp = {
    valor: data.access_token,
    expiraEm: agora + (data.expires_in ?? 3600) * 1000,
  };
  return tokenApp.valor;
}

// Id numerico de um canal a partir do login. Null quando o canal nao existe.
export async function getUserIdByLogin(login: string): Promise<string | null> {
  const token = await getAppToken();
  const res = await fetch(`${HELIX}/users?login=${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId() },
  });
  if (!res.ok) throw new Error(`Falha ao consultar o canal (HTTP ${res.status})`);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return data.data?.[0]?.id || null;
}

// Emotes proprios do canal (sub, bits, follower) pela Helix.
export async function getChannelEmotes(broadcasterId: string): Promise<unknown> {
  const token = await getAppToken();
  const res = await fetch(`${HELIX}/chat/emotes?broadcaster_id=${encodeURIComponent(broadcasterId)}`, {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId() },
  });
  if (!res.ok) throw new Error(`Falha ao listar emotes do canal (HTTP ${res.status})`);
  return res.json();
}

// Login do usuario "master": ve todos os moderados + pode buscar qualquer
// streamer. Configuravel; padrao "asrus12".
export function masterLogin(): string {
  return (process.env.TWITCH_MASTER_LOGIN || "asrus12").trim().toLowerCase();
}

export function isMaster(login: string): boolean {
  return login.trim().toLowerCase() === masterLogin();
}
