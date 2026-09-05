import { criarClienteServidor } from "./supabase/servidor";

// Extrai o usuario autenticado a partir do header Authorization: Bearer <token>
// que o browser envia (token vindo de supabase.auth.getSession()).
export async function obterUsuarioDoPedido(req: Request) {
  const cabecalho = req.headers.get("authorization");
  const token = cabecalho?.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const supabase = criarClienteServidor();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user;
}

// Confere que o usuario autenticado existe em perfis com papel = admin.
export async function exigirAdmin(req: Request) {
  const usuario = await obterUsuarioDoPedido(req);
  if (!usuario) return null;

  const supabase = criarClienteServidor();
  const { data: perfil, error } = await supabase
    .from("perfis")
    .select("id, papel, areas")
    .eq("id", usuario.id)
    .single();

  if (error || !perfil || perfil.papel !== "admin") return null;

  return { usuario, perfil };
}

// Confere que o usuario autenticado tem a area indicada em perfis.areas.
export async function exigirArea(req: Request, area: string) {
  const usuario = await obterUsuarioDoPedido(req);
  if (!usuario) return null;

  const supabase = criarClienteServidor();
  const { data: perfil, error } = await supabase
    .from("perfis")
    .select("id, papel, areas")
    .eq("id", usuario.id)
    .single();

  if (error || !perfil || !perfil.areas?.includes(area)) return null;

  return { usuario, perfil };
}
