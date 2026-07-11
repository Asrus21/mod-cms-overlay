# mod-cms-overlay

Mini-CMS que permite que moderadores da live disparem imagens, gifs e
vídeos diretamente na tela de transmissão (OBS), em tempo real, através de
um painel de controle web.

A arquitetura completa está documentada em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Componentes neste repositório

| Rota | O que é |
|------|---------|
| `/` | Landing simples com link para o painel |
| `/painel` | Painel do mod (protegido por login + verificação de moderador) |
| `/overlay` | Página transparente para adicionar como Browser Source no OBS |
| `/api/auth/*` | Login via Twitch OAuth (NextAuth) |
| `/api/media` | `GET` lista/filtra a biblioteca, `POST` cadastra midia após upload |
| `/api/media/upload` | Recebe o arquivo e repassa ao Vercel Blob |
| `/api/trigger/show` | Dispara uma mídia no overlay |
| `/api/trigger/clear` | Limpa o overlay imediatamente |
| `/api/audit` | Histórico de disparos/limpezas |

## Stack

- **Next.js 14 (App Router) + TypeScript** — painel, overlay e API routes num único deploy (Vercel)
- **NextAuth + Twitch provider** — login, com verificação de moderador via Twitch Helix API
  (`lib/twitch.ts`) e registro local em `Mod` (`lib/auth.ts`)
- **Prisma + Postgres** — `Mod`, `Media`, `AuditLog` (`prisma/schema.prisma`)
- **Pusher** — camada de tempo real; canal único `overlay` com eventos `media:show` / `media:clear`
  (`lib/realtime.ts`)
- **Vercel Blob** — armazenamento dos arquivos binários (`lib/storage.ts`)

## Setup local

```bash
npm install
cp .env.example .env.local   # preencher com credenciais reais
npx prisma migrate dev       # cria as tabelas no Postgres configurado em DATABASE_URL
npm run dev
```

Variáveis necessárias estão descritas em `.env.example`:

- `DATABASE_URL` — Postgres (Vercel Postgres, Neon, Supabase, etc.)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_BROADCASTER_ID`
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`,
  `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`
- `BLOB_READ_WRITE_TOKEN`

No OBS, adicione `/overlay` como Browser Source (fundo transparente).

## Estado deste scaffold

Este é um scaffold inicial seguindo a arquitetura descrita em `docs/ARCHITECTURE.md`.
Ainda não foi testado contra credenciais reais de Twitch/Pusher/Blob/Postgres —
isso requer preencher `.env.local` e rodar `prisma migrate dev` contra um banco real.
