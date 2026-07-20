import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";

type LoginRow = {
  login: string;
  display: string;
  firstLoginAt: string;
  approx: boolean;
};

async function listLogins(): Promise<LoginRow[]> {
  const rows = await prisma.loginHistory.findMany({
    orderBy: { firstLoginAt: "desc" },
    take: 500,
  });
  return rows.map((r) => ({
    login: r.login,
    display: r.display || r.login,
    firstLoginAt: r.firstLoginAt.toISOString(),
    approx: r.approx,
  }));
}

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "";
}

// GET /api/me/logins — historico do PRIMEIRO login de cada usuario no painel.
// Exclusivo do master (asrus12). Devolve apenas o nick e a data/hora — nada
// alem disso. Ordenado do mais recente para o mais antigo.
export async function GET(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  if (!session.master) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  let logins: LoginRow[] = [];
  try {
    logins = await listLogins();
  } catch (err) {
    console.warn("[me/logins] falha ao ler:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ logins });
}

// POST /api/me/logins — backfill (so master). Estima o primeiro acesso de quem
// ja usava o painel ANTES de existir o registro de login, a partir do rastro
// mais antigo deixado no banco: log de auditoria, midias cadastradas, acessos
// concedidos e canais moderados. A data e APROXIMADA (approx=true) — e o
// primeiro rastro conhecido, nao o login exato. So diminui a data ja gravada
// (nunca sobrescreve por uma mais recente).
export async function POST(request: NextRequest) {
  const { session, response } = requireMod(request);
  if (response) return response;
  if (!session.master) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  // login (minusculo) -> data mais antiga encontrada nos rastros.
  const earliest = new Map<string, Date>();
  const consider = (loginRaw: unknown, when: Date | null | undefined) => {
    const login = norm(loginRaw);
    if (!login || !when) return;
    const cur = earliest.get(login);
    if (!cur || when < cur) earliest.set(login, when);
  };

  try {
    const [audit, media, access, mods] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["actor"], _min: { createdAt: true } }),
      prisma.media.groupBy({ by: ["createdBy"], _min: { createdAt: true } }),
      prisma.mesaAccess.groupBy({ by: ["grantedBy"], _min: { createdAt: true } }),
      prisma.moderatedChannel.groupBy({ by: ["modLogin"], _min: { updatedAt: true } }),
    ]);
    for (const r of audit) consider(r.actor, r._min.createdAt);
    for (const r of media) consider(r.createdBy, r._min.createdAt);
    for (const r of access) consider(r.grantedBy, r._min.createdAt);
    for (const r of mods) consider(r.modLogin, r._min.updatedAt);
  } catch (err) {
    console.error("[me/logins] backfill: falha ao ler rastros:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Falha ao ler dados antigos" }, { status: 500 });
  }

  // Datas ja gravadas: so importamos se for MAIS ANTIGO que o registrado.
  let imported = 0;
  try {
    const existing = await prisma.loginHistory.findMany({
      select: { login: true, firstLoginAt: true },
    });
    const known = new Map(existing.map((e) => [e.login, e.firstLoginAt]));

    for (const [login, when] of earliest) {
      const cur = known.get(login);
      if (cur && cur <= when) continue; // ja temos data igual/mais antiga
      await prisma.loginHistory.upsert({
        where: { login },
        update: { firstLoginAt: when, approx: true },
        create: { login, firstLoginAt: when, approx: true },
      });
      imported++;
    }
  } catch (err) {
    console.error("[me/logins] backfill: falha ao gravar:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Falha ao importar" }, { status: 500 });
  }

  let logins: LoginRow[] = [];
  try {
    logins = await listLogins();
  } catch {
    // ignora — o importante ja foi gravado.
  }
  return NextResponse.json({ ok: true, imported, logins });
}
