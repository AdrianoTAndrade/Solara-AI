import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { exigirAdmin } from "@/lib/api-auth";

type CorpoCriarUsuario = {
  email?: string;
  senha?: string;
  nome?: string;
  papel?: "admin" | "operador";
  areas?: string[];
};

// Cria usuario no Supabase Auth e a linha correspondente em perfis. So admin.
export async function POST(req: Request) {
  const contexto = await exigirAdmin(req);
  if (!contexto) {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const corpo = (await req.json()) as CorpoCriarUsuario;
  const { email, senha, nome, papel, areas } = corpo;

  if (!email || !senha || !nome || !papel) {
    return NextResponse.json(
      { erro: "Preencha e-mail, senha, nome e papel." },
      { status: 400 }
    );
  }

  const supabase = criarClienteServidor();

  const { data: novoUsuario, error: erroAuth } = await supabase.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (erroAuth || !novoUsuario.user) {
    return NextResponse.json(
      { erro: erroAuth?.message ?? "Falha ao criar usuario no Auth" },
      { status: 400 }
    );
  }

  const { error: erroPerfil } = await supabase.from("perfis").insert({
    id: novoUsuario.user.id,
    email,
    nome,
    papel,
    areas: areas ?? [],
  });

  if (erroPerfil) {
    // sem perfil o usuario fica orfao: desfaz a criacao no Auth
    await supabase.auth.admin.deleteUser(novoUsuario.user.id);
    return NextResponse.json({ erro: erroPerfil.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
