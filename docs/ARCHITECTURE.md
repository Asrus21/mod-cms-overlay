# Arquitetura — Mini-CMS de Overlay para Mods

## 1. Visão geral

Sistema que permite que moderadores da live disparem imagens, gifs e vídeos
diretamente na tela de transmissão, em tempo real, através de um painel de
controle web. A arquitetura tem três camadas principais: o painel do mod
(front-end de controle), o backend/API (regras de negócio e persistência) e
o overlay (o que efetivamente aparece no OBS).

Objetivo do documento: descrever a arquitetura completa, os componentes, o
fluxo de dados e as decisões técnicas — sem entrar em código, apenas na
estrutura do sistema.

---

## 2. Componentes do sistema

### 2.1 Painel do mod (Control Panel)

Aplicação web acessível apenas por usuários autenticados com permissão de
moderador no canal. É por onde o mod:

- Visualiza a biblioteca de mídias já cadastradas (imagens, gifs, vídeos)
- Busca e filtra mídias por tag, tipo ou nome
- Envia (upload) novas mídias para a biblioteca
- Dispara uma mídia para aparecer no overlay, com duração configurável
- Limpa o overlay imediatamente, cancelando qualquer exibição em andamento
- Visualiza o status da conexão em tempo real (conectado/desconectado)
- Visualiza um histórico simples do último disparo (o quê, quem, quando)

Roda hospedado como aplicação web comum (deploy na Vercel), acessada pelo
navegador em qualquer dispositivo — não precisa estar na mesma máquina que
roda o OBS.

### 2.2 Overlay (o que aparece na live)

Uma página web separada, carregada como Browser Source dentro do OBS. Ela
não tem interface visível de controle — é uma "tela em branco" que:

- Fica conectada, ouvindo por eventos em tempo real
- Ao receber um comando de exibição, renderiza a mídia correspondente na
  tela por um tempo determinado
- Ao receber um comando de limpeza, remove imediatamente o que estiver
  sendo exibido, mesmo que o tempo normal de exibição não tenha acabado
- Tem fundo transparente, para se integrar visualmente com a cena do OBS

### 2.3 Backend / API

Camada intermediária que:

- Autentica e autoriza cada ação (confirma que quem está chamando é
  realmente um mod do canal)
- Gerencia a biblioteca de mídias (cadastro, metadados, tags)
- Recebe os comandos do painel (mostrar mídia, limpar tela)
- Publica esses comandos na camada de tempo real, para que o overlay reaja
- Registra um log de auditoria de cada ação (quem disparou o quê e quando)

### 2.4 Camada de tempo real

Responsável por levar o comando do backend até o overlay quase
instantaneamente. Como o hospedeiro principal (Vercel) não mantém conexões
abertas de forma nativa, essa camada é um serviço externo especializado
(ex: Pusher ou Ably), que funciona como uma central de mensagens: o backend
publica um evento, e todos os overlays conectados àquele canal recebem o
evento ao mesmo tempo.

### 2.5 Banco de dados

Armazena três tipos de informação:

- **Cadastro de mods**: quem tem permissão de usar o painel
- **Biblioteca de mídias**: metadados de cada imagem/gif/vídeo (não o
  arquivo em si — isso fica em um serviço de armazenamento de arquivos)
- **Log de disparos**: histórico de auditoria de cada ação realizada

### 2.6 Armazenamento de arquivos

Serviço separado dedicado a guardar os arquivos binários (imagens, gifs,
vídeos). O banco de dados guarda apenas a referência (URL) para esses
arquivos, não o conteúdo pesado em si.

---

## 3. Fluxo de dados — cenário "mostrar mídia"

1. Mod abre o painel e escolhe uma mídia da biblioteca
2. Painel envia o pedido para o backend, informando qual mídia e por
   quanto tempo deve ficar visível
3. Backend confirma que o solicitante é mod autorizado
4. Backend registra a ação no log de auditoria
5. Backend publica um evento na camada de tempo real, com a informação da
   mídia e da duração
6. O overlay, que está sempre ouvindo essa camada, recebe o evento
   instantaneamente
7. O overlay renderiza a mídia na tela
8. Após o tempo configurado, o próprio overlay remove a mídia
   automaticamente

## 4. Fluxo de dados — cenário "limpar tela agora"

1. Mod clica no botão de limpeza, sem selecionar nenhuma mídia
2. Painel envia um pedido simples ao backend, sem parâmetros de conteúdo
3. Backend confirma autorização e registra a ação no log
4. Backend publica um evento de "limpeza" na camada de tempo real — um
   tipo de evento diferente do de exibição, para não haver ambiguidade
5. O overlay recebe o evento de limpeza e reage imediatamente:
   cancela qualquer temporizador de exibição que estivesse em andamento e
   remove a mídia da tela na hora, sem esperar o tempo normal expirar
6. Se, por coincidência, dois eventos chegarem quase juntos (um "mostrar"
   e um "limpar"), a regra é que o evento de limpeza sempre tem prioridade
   sobre qualquer exibição em andamento

## 5. Fluxo de dados — cenário "cadastrar nova mídia"

1. Mod seleciona um arquivo no painel (upload)
2. O arquivo é enviado diretamente para o serviço de armazenamento de
   arquivos
3. O backend recebe a referência (URL) do arquivo armazenado e cria um
   registro na biblioteca de mídias, com metadados (nome, tipo, tags,
   quem cadastrou)
4. O painel atualiza a lista de mídias disponíveis, já incluindo a nova

---

## 6. Autenticação e autorização

> **Nota de implementação (atual):** a primeira versão online usa uma
> **senha compartilhada** (`MOD_ACCESS_KEY`) em vez de Twitch OAuth, para
> simplificar a operação. O mod entra com o próprio nome + a senha; o backend
> valida a senha e devolve um cookie de sessão **assinado por HMAC**
> (`lib/session.ts`). O nome informado alimenta o log de auditoria. O texto
> abaixo descreve o desenho original com Twitch OAuth, que continua sendo a
> evolução natural caso se queira identidade individual forte por mod.

- Login feito via Twitch OAuth, o mesmo mecanismo já usado em outros
  projetos do canal
- Após o login, o sistema confirma junto à API da Twitch se aquele usuário
  é de fato moderador do canal em questão
- Toda ação sensível (disparar mídia, limpar tela, cadastrar mídia) é
  validada no backend a cada chamada — nunca confiando apenas na
  interface visual do painel esconder ou mostrar botões

## 7. Auditoria e segurança operacional

- Cada disparo e cada limpeza fica registrado: quem fez, o quê, e quando
- Isso serve tanto para prestação de contas quanto para identificar uso
  indevido (por exemplo, alguém limpando repetidamente o conteúdo de
  outro mod)
- A camada de tempo real deve ter um mecanismo de status visível no
  painel, para o mod saber se está de fato conectado antes de tentar
  disparar algo

## 8. Componentes que ficam de fora do escopo inicial

- Edição de mídia dentro do próprio painel (cortes, redimensionamento)
- Fila com múltiplas mídias em sequência automática
- Permissões diferenciadas entre mods (todos os mods têm o mesmo nível de
  acesso na primeira versão)
- Aplicativo mobile dedicado (o painel web funciona em qualquer navegador,
  incluindo celular)

> **Adendo — feed ao vivo do mod (implementado):** além do disparo de mídias
> (arquivos), o painel permite que um mod transmita **câmera ou tela ao vivo**
> para o OBS do streamer. Isso é um fluxo separado, baseado em **WebRTC via
> [VDO.Ninja](https://vdo.ninja)**: o vídeo trafega direto do mod para o OBS
> (Browser Source com o link de *scene* da sala), **não** passa pelo backend
> nem pela camada de tempo real (Pusher). O backend só registra no log de
> auditoria quem foi ao vivo e quando (`/api/live`). Configuração via
> `VDO_ROOM` / `VDO_PASSWORD`. Ver `lib/vdo.ts` e o README.

---

## 9. Resumo das responsabilidades por componente

| Componente              | Responsabilidade principal                                   |
|--------------------------|---------------------------------------------------------------|
| Painel do mod             | Interface de controle, autenticação do usuário                |
| Overlay (OBS)              | Renderização visual em tempo real, sem lógica de negócio      |
| Backend / API               | Regras de negócio, autorização, orquestração dos eventos     |
| Camada de tempo real          | Entrega instantânea dos comandos do backend para o overlay |
| Banco de dados                  | Persistência de mods, biblioteca e auditoria              |
| Armazenamento de arquivos          | Guarda os binários de imagem/gif/vídeo                 |
