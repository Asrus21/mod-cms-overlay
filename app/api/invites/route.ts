import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { canControlStreamer } from "@/lib/access";
import { streamerSlug } from "@/lib/accounts";
import { chaveDoCodigo, formatarCodigo, gerarCodigo, normalizarLogin } from "@/lib/invites";
import { mensagemDeBanco, tabelaAusente } from "@/lib/db-errors";

// Convites de acesso a mesa de um streamer (aba "Editores" das configuracoes).
//
// Quem pode gerar e quem ja pode gerenciar aquele streamer — na pratica o
// proprio streamer, o master, ou alguem que ja recebeu acesso. Cada codigo
// vale uma vez so.

// Tentativas de gerar um codigo que ainda nao existe. Com 30^12 combinacoes a
// chance de repetir e desprezivel; o laco existe so para o `code` ser unico
// mesmo no azar absurdo.
const TENTATIVAS = 5;

function paraFora(r: {
  id: string;
  code: string;
  forLogin: string;
  usedBy: string;
  usedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    code: formatarCodigo(r.code),
    forLogin: r.forLogin,
    usedBy: r.usedBy,
    usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// GET /api/invites?streamer=<login> — codigos daquele streamer.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const streamer = streamerSlug(request.nextUrl.searchParams.get("streamer") || "");
  if (!streamer) return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Sem acesso a este streamer" }, { status: 403 });
  }

  try {
    const rows = await prisma.mesaInvite.findMany({
      where: { streamer },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ invites: rows.map(paraFora) });
  } catch (err) {
    return NextResponse.json(
      { invites: [], unavailable: true, reason: mensagemDeBanco(err, "Os convites") },
      { status: tabelaAusente(err) ? 503 : 500 }
    );
  }
}

// POST /api/invites — gera um codigo. body: { streamer, streamerName?, forLogin? }
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    streamer?: string;
    streamerName?: string;
    forLogin?: string;
  } | null;

  const streamer = streamerSlug(body?.streamer || "");
  if (!streamer) return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });

  // Em branco e proposital: o codigo serve para quem usar primeiro, e o nome
  // de quem usou fica gravado depois.
  const forLogin = normalizarLogin(body?.forLogin || "");
  if (forLogin === null) {
    return NextResponse.json(
      { error: "Usuário inválido (3-25: letras, números ou _). Deixe em branco para valer para qualquer um." },
      { status: 400 }
    );
  }
  if (forLogin && forLogin === streamer) {
    return NextResponse.json({ error: "O próprio streamer já tem acesso." }, { status: 400 });
  }
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Sem acesso para gerenciar este streamer" }, { status: 403 });
  }

  const streamerName = (body?.streamerName || streamer).toString().slice(0, 60);

  for (let i = 0; i < TENTATIVAS; i++) {
    const code = chaveDoCodigo(gerarCodigo());
    try {
      const criado = await prisma.mesaInvite.create({
        data: { code, streamer, streamerName, forLogin, createdBy: session.name },
      });
      return NextResponse.json({ ok: true, invite: paraFora(criado) }, { status: 201 });
    } catch (err) {
      // P2002 = colisao no `code`; qualquer outro erro e real.
      const codigo = (err as { code?: string })?.code;
      if (codigo === "P2002") continue;
      return NextResponse.json(
        { error: mensagemDeBanco(err, "Os convites") },
        { status: tabelaAusente(err) ? 503 : 500 }
      );
    }
  }
  return NextResponse.json({ error: "Não foi possível gerar um código. Tente de novo." }, { status: 500 });
}

// DELETE /api/invites — apaga um codigo ainda nao usado. body: { id }
export async function DELETE(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "id e obrigatorio" }, { status: 400 });

  try {
    const alvo = await prisma.mesaInvite.findUnique({ where: { id: body.id } });
    if (!alvo) return NextResponse.json({ ok: true });
    if (!(await canControlStreamer(session.name, session.master, alvo.streamer))) {
      return NextResponse.json({ error: "Sem acesso para gerenciar este streamer" }, { status: 403 });
    }
    // Apagar um convite JA USADO nao tira o acesso de ninguem (quem usou virou
    // uma linha em MesaAccess). Para tirar acesso e a lista de editores.
    await prisma.mesaInvite.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: mensagemDeBanco(err, "Os convites") },
      { status: tabelaAusente(err) ? 503 : 500 }
    );
  }
}
