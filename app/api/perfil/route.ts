import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { obterUsuarioDoPedido } from "@/lib/api-auth";

// Devolve o perfil do usuario autenticado (nome, papel, areas).
export async function GET(req: Request) {
  const usuario = await obterUsuarioDoPedido(req);
  if (!usuario) {
    return NextResponse.json({ erro: "Nao autenticado" }, { status: 401 });
  }

  const supabase = criarClienteServidor();
  const { data: perfil, error } = await supabase
    .from("perfis")
    .select("id, email, nome, papel, areas")
    .eq("id", usuario.id)
    .single();

  if (error || !perfil) {
    return NextResponse.json({ erro: "Perfil nao encontrado" }, { status: 404 });
  }

  return NextResponse.json({ perfil });
}
