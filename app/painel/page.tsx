import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { PainelClient } from "./PainelClient";

// A checagem "de verdade" acontece nas rotas de API (secao 6). Aqui validamos
// a assinatura do cookie no servidor para ja ter o nome do mod no primeiro
// render — e barrar quem forjou so a presenca do cookie para passar o
// middleware.
export default function PainelPage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    redirect("/painel/login");
  }

  return <PainelClient modName={session.name} />;
}
