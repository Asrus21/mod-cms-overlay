import { NextRequest, NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";

// GET /api/health — diagnostico de configuracao. Retorna APENAS se cada
// variavel esta presente (booleans), nunca os valores. Protegido por sessao
// de mod. Serve para o painel mostrar rapidamente o que falta configurar na
// Vercel, sem precisar tentar por tentativa e erro.
export async function GET(request: NextRequest) {
  const { response } = requireMod(request);
  if (response) return response;

  const has = (v?: string) => Boolean(v && v.trim().length > 0);

  const serverCluster = process.env.PUSHER_CLUSTER || "";
  const publicCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "";

  return NextResponse.json({
    db: has(process.env.POSTGRES_PRISMA_URL) && has(process.env.POSTGRES_URL_NON_POOLING),
    blob: has(process.env.BLOB_READ_WRITE_TOKEN),
    auth: {
      accessKey: has(process.env.MOD_ACCESS_KEY),
      sessionSecret: has(process.env.SESSION_SECRET),
    },
    pusher: {
      appId: has(process.env.PUSHER_APP_ID),
      key: has(process.env.PUSHER_KEY),
      secret: has(process.env.PUSHER_SECRET),
      cluster: has(serverCluster),
      publicKey: has(process.env.NEXT_PUBLIC_PUSHER_KEY),
      publicCluster: has(publicCluster),
      // So sinaliza divergencia se ambos existirem.
      clusterMatch: !has(serverCluster) || !has(publicCluster) || serverCluster === publicCluster,
    },
    vdo: has(process.env.VDO_ROOM),
  });
}
