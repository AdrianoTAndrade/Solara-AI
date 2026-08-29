import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { exigirAdmin } from "@/lib/api-auth";

// Lista todos os perfis. So admin.
export async function GET(req: Request) {
  const contexto = await exigirAdmin(req);
  if (!contexto) {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const supabase = criarClienteServidor();
  const { data: perfis, error } = await supabase
    .from("perfis")
    .select("id, email, nome, papel, areas, criado_em")
    .order("criado_em", { ascending: true });

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ perfis });
}
