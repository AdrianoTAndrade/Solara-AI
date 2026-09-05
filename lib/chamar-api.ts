import { criarClienteNavegador } from "./supabase/cliente";

// Chama uma rota /api/* do proprio app anexando o token da sessao atual
// no header Authorization, para as rotas que exigem usuario autenticado/admin.
export async function chamarApi(caminho: string, opcoes: RequestInit = {}) {
  const supabase = criarClienteNavegador();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const cabecalhos = new Headers(opcoes.headers);
  if (session?.access_token) {
    cabecalhos.set("Authorization", `Bearer ${session.access_token}`);
  }
  // FormData (upload de arquivo) define seu proprio Content-Type com o
  // boundary do multipart — nao mexer nesse caso.
  if (opcoes.body && !(opcoes.body instanceof FormData) && !cabecalhos.has("Content-Type")) {
    cabecalhos.set("Content-Type", "application/json");
  }

  return fetch(caminho, { ...opcoes, headers: cabecalhos });
}
