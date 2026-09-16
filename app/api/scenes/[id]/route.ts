import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireMod } from "@/lib/require-mod";
import { modSlug } from "@/lib/accounts";
import { sanitizeSceneItems } from "@/lib/scenes";

// GET /api/scenes/<id> — itens de uma cena, para a mesa reconstruir o arranjo.
// So o dono da cena le a propria cena.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { session, response } = requireMod(request);
  if (response) return response;
  const owner = modSlug(session.name);

  try {
    const scene = await prisma.scene.findFirst({ where: { id: params.id, owner } });
    if (!scene) {
      return NextResponse.json({ error: "Cena nao encontrada" }, { status: 404 });
    }
    // Sanitiza tambem na leitura: uma cena salva por uma versao antiga pode
    // ter campos que nao valem mais.
    return NextResponse.json({
      id: scene.id,
      name: scene.name,
      items: sanitizeSceneItems(scene.items),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao ler a cena";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
