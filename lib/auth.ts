import type { AuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import TwitchProvider from "next-auth/providers/twitch";
import { prisma } from "./db";
import { isTwitchModerator } from "./twitch";

declare module "next-auth" {
  interface Session {
    isMod: boolean;
    modId?: string;
    twitchUserId?: string;
  }
}

export const authOptions: AuthOptions = {
  providers: [
    TwitchProvider({
      clientId: process.env.TWITCH_CLIENT_ID || "",
      clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // Secao 6: apos o login, confirma junto a API da Twitch se o usuario
    // e de fato moderador do canal. Nunca confia so na sessao existir.
    async jwt({ token, profile }): Promise<JWT> {
      if (profile) {
        const twitchProfile = profile as {
          sub?: string;
          preferred_username?: string;
          id?: string;
          login?: string;
          display_name?: string;
        };
        const twitchUserId = twitchProfile.sub || twitchProfile.id || "";
        const broadcasterId = process.env.TWITCH_BROADCASTER_ID || "";

        let isMod = false;
        try {
          isMod = await isTwitchModerator(broadcasterId, twitchUserId);
        } catch {
          // Fail-closed: se a verificacao falhar, trata como nao-mod.
          isMod = false;
        }

        if (isMod) {
          const mod = await prisma.mod.upsert({
            where: { twitchUserId },
            update: {
              lastVerifiedAt: new Date(),
              displayName: twitchProfile.display_name || twitchProfile.preferred_username || "",
            },
            create: {
              twitchUserId,
              twitchLogin: twitchProfile.login || twitchProfile.preferred_username || "",
              displayName: twitchProfile.display_name || twitchProfile.preferred_username || "",
            },
          });
          token.modId = mod.id;
        } else {
          token.modId = undefined;
        }

        token.isMod = isMod;
        token.twitchUserId = twitchUserId;
      }
      return token;
    },
    async session({ session, token }): Promise<Session> {
      session.isMod = Boolean(token.isMod);
      session.modId = token.modId as string | undefined;
      session.twitchUserId = token.twitchUserId as string | undefined;
      return session;
    },
  },
};
