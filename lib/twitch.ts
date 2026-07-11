// Confirmacao de moderador junto a API da Twitch (secao 6). Requer um app
// access token (client credentials) do proprio app configurado em
// TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.

let cachedAppToken: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now()) {
    return cachedAppToken.token;
  }

  const clientId = process.env.TWITCH_CLIENT_ID || "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao obter app access token da Twitch: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAppToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedAppToken.token;
}

// Confirma se `userId` e moderador do canal `broadcasterId`.
// Nota: o endpoint Get Moderators da Twitch aceita app access token, mas
// exige que o app tenha sido autorizado pelo broadcaster com o escopo
// moderation:read em algum momento (via OAuth do broadcaster).
export async function isTwitchModerator(
  broadcasterId: string,
  userId: string
): Promise<boolean> {
  const token = await getAppAccessToken();
  const clientId = process.env.TWITCH_CLIENT_ID || "";

  const url = new URL("https://api.twitch.tv/helix/moderation/moderators");
  url.searchParams.set("broadcaster_id", broadcasterId);
  url.searchParams.set("user_id", userId);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId,
    },
  });

  if (!res.ok) {
    throw new Error(`Falha ao consultar moderadores na Twitch: ${res.status}`);
  }

  const data = (await res.json()) as { data: Array<{ user_id: string }> };
  return data.data.some((m) => m.user_id === userId);
}
