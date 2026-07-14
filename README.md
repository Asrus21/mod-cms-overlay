# mod-cms-overlay

Mini-CMS de overlay para lives. Seus **moderadores acessam uma URL**, enviam
imagens, gifs, vídeos ou áudios, e o conteúdo aparece **em tempo real** no
overlay que você adiciona como *Browser Source* no OBS.

- **Painel do mod:** `https://SEU-APP.vercel.app/mod/painelMod`
- **Overlay do OBS:** `https://SEU-APP.vercel.app/overlay`

A arquitetura completa está em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Como funciona (visão rápida)

```
  Mod (navegador)                Backend (Vercel)             Overlay (OBS)
 ┌───────────────┐   POST      ┌────────────────┐  publica  ┌──────────────┐
 │  /painel      │ ─────────▶  │  API routes    │ ────────▶ │  /overlay    │
 │  envia/dispara│             │  auth + audit  │  (Pusher) │  renderiza   │
 └───────────────┘             └───────┬────────┘           └──────────────┘
                                       │ metadados / log
                                 ┌─────▼──────┐   binários  ┌──────────────┐
                                 │  Postgres  │             │ Vercel Blob  │
                                 │  (Neon)    │             │ (arquivos)   │
                                 └────────────┘             └──────────────┘
```

Serviços usados: **Vercel** (hospedagem), **Neon Postgres** (banco),
**Vercel Blob** (arquivos) e **Pusher** (tempo real).

| Rota | O que é |
|------|---------|
| `/` | Landing simples com link para o painel |
| `/mod/painelMod` | Painel do mod (login com nome + senha compartilhada) |
| `/mod/painelMod/login` | Tela de login do painel |
| `/painel` | Redireciona (308) para `/mod/painelMod` (link antigo) |
| `/overlay/<streamer>` | Overlay permanente do streamer (Browser Source no OBS do streamer) |
| `/mesa/<streamer>/<mod>` | Mesa do mod para o OBS do próprio mod: fundo (Twitch ou sem fundo) + os itens desse mod |
| `/api/login` · `/api/logout` | Sessão do mod (cookie assinado) |
| `/api/media` | `GET` lista/filtra a biblioteca · `POST` cadastra mídia após upload |
| `/api/media/upload` | Recebe o arquivo e repassa ao Vercel Blob |
| `/api/trigger/show` | Dispara uma mídia no overlay |
| `/api/trigger/move` | Atualiza posição/escala da mídia em tempo real (mesa) |
| `/api/trigger/clear` | Limpa o overlay imediatamente |
| `/api/live` | Registra no log que um mod foi ao vivo (feed via VDO.Ninja) |
| `/api/audit` | Histórico de disparos/limpezas |

---

## Passo a passo para colocar online

Você já tem Vercel + Neon. Falta conectar o repositório, criar a store de
arquivos, criar o Pusher e definir 4 variáveis suas.

### 1. Importar o projeto na Vercel

1. Vercel → **Add New… → Project** → importe o repositório `mod-cms-overlay`.
2. Framework: **Next.js** (detectado automaticamente). Não precisa mudar nada
   no build — o `package.json` já roda `prisma generate && prisma db push`
   no build, então as tabelas são criadas sozinhas no primeiro deploy.

### 2. Banco de dados (Neon)

Na aba **Storage** do projeto, conecte o banco **Neon**. A integração injeta
sozinha as variáveis `POSTGRES_PRISMA_URL` e `POSTGRES_URL_NON_POOLING`, que é
exatamente o que o Prisma usa (pooled para o app, direta para criar as tabelas).
Você não precisa configurar nada de banco à mão.

### 3. Armazenamento de arquivos (Vercel Blob)

Ainda em **Storage → Create Database → Blob**, crie uma store e conecte ao
projeto. Isso injeta `BLOB_READ_WRITE_TOKEN` automaticamente. É onde os
arquivos que os mods enviam ficam guardados.

### 4. Tempo real (Pusher)

1. Crie conta grátis em <https://pusher.com> → **Channels → Create app**.
2. Escolha um cluster (ex.: `us2`) e anote.
3. Na aba **App Keys** copie `app_id`, `key`, `secret`, `cluster`.

### 5. Variáveis de ambiente (Vercel → Settings → Environment Variables)

As de banco e blob já vieram das integrações. Adicione estas:

| Variável | Valor |
|---|---|
| `MOD_ACCESS_KEY` | A **senha** que você vai dar aos mods |
| `SESSION_SECRET` | Um segredo aleatório (veja abaixo) |
| `PUSHER_APP_ID` | do Pusher |
| `PUSHER_KEY` | do Pusher |
| `PUSHER_SECRET` | do Pusher |
| `PUSHER_CLUSTER` | ex.: `us2` |
| `NEXT_PUBLIC_PUSHER_KEY` | **mesmo** valor de `PUSHER_KEY` |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | **mesmo** valor de `PUSHER_CLUSTER` |
| `VDO_ROOM` | Nome secreto da sala do feed ao vivo (opcional — veja abaixo) |
| `VDO_PASSWORD` | Senha da sala do feed ao vivo (opcional) |

Gere o `SESSION_SECRET` com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 6. Deploy

Clique em **Deploy** (ou faça um push — cada push na branch `main` redeploya).
Pronto: o app sobe e as tabelas são criadas no Neon no build.

---

## Usando no dia a dia

### Você (dono do canal) — configurar o OBS

1. No OBS: **Fontes → + → Navegador (Browser Source)**.
2. URL: `https://SEU-APP.vercel.app/overlay`
3. Largura/altura iguais à sua cena (ex.: 1920×1080).
4. O overlay tem fundo transparente e toca vídeo/áudio automaticamente dentro
   do OBS.

### Seus mods — usar o painel

1. Abrem `https://SEU-APP.vercel.app/mod/painelMod`.
2. Entram com **o próprio nome** + a **senha** (`MOD_ACCESS_KEY`) que você passou.
3. **Enviar mídia:** escolhem arquivo (imagem, gif, vídeo ou áudio). Se deixarem
   marcado *"Mostrar no overlay assim que enviar"*, já aparece na hora.
4. **Disparar da biblioteca:** clicam em **Mostrar** em qualquer mídia já salva.
5. **Limpar:** o botão *"Limpar overlay agora"* remove na hora o que estiver na
   tela (tem prioridade sobre qualquer exibição em andamento).
6. Cada ação fica registrada no **Histórico** (quem, o quê, quando).

O nome que o mod digita no login é o que aparece no histórico de auditoria.

---

## Mesa ao vivo (arrastar mídia com o mouse)

Além do "flash" de 5s (botão **Mostrar**), o painel tem a **Mesa ao vivo**: o mod
coloca uma imagem/gif/vídeo na tela e **arrasta com o mouse**, e o overlay do OBS
**acompanha o movimento em tempo real** — sem compartilhar tela, sem câmera.

Como funciona: a posição (x, y) e o tamanho são enviados como coordenadas
normalizadas pela mesma camada de tempo real (Pusher) que já usamos; o overlay
move o elemento na hora, com uma leve suavização entre os updates. Não precisa de
nada além do Pusher que você já configurou.

No painel: **Mesa ao vivo → escolha a mídia → Colocar na mesa**, depois arraste o
item na prévia (que tem a proporção 16:9 da sua cena). O controle **Tamanho**
ajusta a escala. **Tirar da mesa** remove do overlay.

### Mesa no OBS do próprio mod

Cada mod tem também um **link da sua mesa para o OBS dele** (`/mesa/<streamer>/<mod>`),
gerado na seção **Fundo da mesa** do painel. Cole no Browser Source do OBS do mod:
ele mostra o **fundo escolhido** (a *transmissão da Twitch* como fundo, ou *sem
fundo*/transparente) com as **mídias desse mod por cima** — as mesmas que já vão
para o overlay do streamer (mesa individual por mod). Usa a mesma camada de tempo
real (Pusher/websocket) do overlay; nada novo para configurar. O fundo vai
embutido no link (`?fundo=twitch&canal=...`), então **copie o link de novo** se
trocar a opção de fundo. Fundo de *imagem de referência* (print enviado do PC)
continua sendo apenas um guia dentro do painel, não vai para o link.

---

## Feed ao vivo do mod (câmera/tela no seu OBS)

Além de disparar mídias, um mod pode **transmitir a câmera ou a tela ao vivo**
direto para o seu OBS. Isso usa o [VDO.Ninja](https://vdo.ninja) por baixo
(WebRTC) — **sem port forwarding, sem expor IP, sem instalar nada**. O vídeo
não passa pelo nosso servidor; o VDO.Ninja cuida da conexão e da rede.

### Ativar (uma vez)

1. Escolha um **nome de sala secreto** (qualquer texto aleatório e não óbvio —
   ele funciona como senha). Defina em `VDO_ROOM` na Vercel.
2. (Recomendado) Defina também uma `VDO_PASSWORD`.
3. Redeploy.

Sem `VDO_ROOM`, a seção "Transmitir ao vivo" fica desativada no painel.

### No OBS (você, streamer)

1. Entre no painel, abra **Transmitir ao vivo → Configurar no OBS** e copie o
   link (ou pegue o link de *scene* do VDO.Ninja da sua sala).
2. No OBS: **Fontes → + → Navegador**, cole o link, tamanho da cena.
3. Esse único Browser Source mostra **automaticamente** qualquer mod que estiver
   ao vivo naquele momento (fundo transparente para compor na cena).

### Para os mods

No painel, clicam em **📹 Transmitir câmera** ou **🖥️ Transmitir tela**. Abre
uma aba do VDO.Ninja que começa a transmitir; **manter essa aba aberta** enquanto
estiverem ao vivo. Fechar a aba encerra a transmissão. Cada "ao vivo" fica
registrado no histórico.

> Observação: por padrão o overlay mostra todos os mods que estiverem ao vivo ao
> mesmo tempo. Fila/seleção de quem aparece pode ser adicionada depois.

---

## Rodar localmente (opcional)

```bash
cp .env.example .env.local      # preencha os valores
npm install
npx prisma generate
npx prisma db push              # cria as tabelas no banco configurado
npm run dev
```

Abra `http://localhost:3000/mod/painelMod` e `http://localhost:3000/overlay` em abas
separadas. Para o tempo real funcionar local, preencha as variáveis do Pusher.

---

## Segurança

- Todas as ações sensíveis são validadas **no backend** a cada chamada
  (o cookie de sessão é assinado por HMAC), nunca confiando só na interface.
- Sem `MOD_ACCESS_KEY` configurada, o acesso é negado (*fail-closed*).
- O acesso é por **senha compartilhada** — simples de operar para um time de
  mods pequeno. A identidade no log vem do nome que o mod informa no login.
  Se um dia quiser identidade forte (login individual real), dá para trocar por
  Twitch OAuth ou chaves por mod; veja a nota em `docs/ARCHITECTURE.md`.
