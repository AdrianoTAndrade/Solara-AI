import { createBrowserClient } from "@supabase/ssr";

// Cliente Supabase para uso no browser (chave anon). Usado em login e
// para checar a sessao do usuario em componentes client.
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
