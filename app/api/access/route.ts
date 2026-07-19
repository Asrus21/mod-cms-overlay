import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { canControlStreamer } from "@/lib/access";

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "";
}

// GET /api/access?streamer=<login> — lista quem tem acesso concedido a mesa
// daquele streamer. So quem pode gerenciar aquele streamer ve.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const streamer = norm(request.nextUrl.searchParams.get("streamer"));
  if (!streamer) return NextResponse.json({ error: "streamer e obrigatorio" }, { status: 400 });
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Sem acesso a este streamer" }, { status: 403 });
  }

  let grants: { userLogin: string; grantedBy: string }[] = [];
  try {
    const rows = await prisma.mesaAccess.findMany({
      where: { streamer },
      orderBy: { createdAt: "asc" },
    });
    grants = rows.map((r) => ({ userLogin: r.userLogin, grantedBy: r.grantedBy }));
  } catch (err) {
    console.warn("[access] list falhou:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ streamer, grants });
}

// POST /api/access — concede acesso a mesa de um streamer a um usuario.
// body: { streamer, streamerName?, userLogin }
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    streamer?: string;
    streamerName?: string;
    userLogin?: string;
  } | null;

  const streamer = norm(body?.streamer);
  const userLogin = norm(body?.userLogin);
  const streamerName = (body?.streamerName || streamer).toString().slice(0, 60);

  if (!streamer || !userLogin) {
    return NextResponse.json({ error: "Informe o streamer e o usuario" }, { status: 400 });
  }
  if (!LOGIN_RE.test(userLogin)) {
    return NextResponse.json(
      { error: "Usuario da Twitch invalido (3-25: letras, numeros ou _)" },
      { status: 400 }
    );
  }
  if (userLogin === streamer) {
    return NextResponse.json({ error: "O proprio streamer ja tem acesso" }, { status: 400 });
  }
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Sem acesso para gerenciar este streamer" }, { status: 403 });
  }

  try {
    await prisma.mesaAccess.upsert({
      where: { streamer_userLogin: { streamer, userLogin } },
      update: { streamerName, grantedBy: session.name },
      create: { streamer, streamerName, userLogin, grantedBy: session.name },
    });
  } catch (err) {
    console.error("[access] grant falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Falha ao conceder acesso" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/access — revoga acesso. body: { streamer, userLogin }
export async function DELETE(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;

  const body = (await request.json().catch(() => null)) as {
    streamer?: string;
    userLogin?: string;
  } | null;

  const streamer = norm(body?.streamer);
  const userLogin = norm(body?.userLogin);
  if (!streamer || !userLogin) {
    return NextResponse.json({ error: "Informe o streamer e o usuario" }, { status: 400 });
  }
  if (!(await canControlStreamer(session.name, session.master, streamer))) {
    return NextResponse.json({ error: "Sem acesso para gerenciar este streamer" }, { status: 403 });
  }

  try {
    await prisma.mesaAccess.deleteMany({ where: { streamer, userLogin } });
  } catch (err) {
    console.error("[access] revoke falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Falha ao remover acesso" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
