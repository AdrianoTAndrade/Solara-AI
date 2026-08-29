import { createClient } from "@supabase/supabase-js";

// Cliente Supabase para uso no servidor (chave service role). So pode ser
// usado dentro de rotas de API, nunca exposto ao browser.
export function criarClienteServidor() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
