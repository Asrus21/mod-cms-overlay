import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { PainelClient } from "./PainelClient";

// A checagem "de verdade" ja acontece no middleware e em cada rota de API
// (secao 6); isso aqui e so para ter os dados da sessao ja carregados no
// primeiro render.
export default async function PainelPage() {
  const session = await getServerSession(authOptions);

  if (!session?.isMod) {
    redirect("/api/auth/signin");
  }

  return <PainelClient modName={session.twitchUserId ?? ""} />;
}
