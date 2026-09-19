import { redirect } from "next/navigation";

// O painel virou o proprio canvas: o que existia aqui (biblioteca, ao vivo,
// limpar overlay, historico de logins) mudou para a barra de icones e para o
// menu da engrenagem de la. Esta rota fica so como redirecionamento, porque e
// o endereco que os mods tem salvo — e para onde /painel tambem aponta.
export default function PainelPage() {
  redirect("/mod/painelMod/canvas");
}
