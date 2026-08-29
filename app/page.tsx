"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/cliente";

export default function PaginaInicial() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    const supabase = criarClienteNavegador();

    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? "");
      setVerificando(false);
    });
  }, [router]);

  if (verificando) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Solara OS</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{email}</p>
      </div>
    </div>
  );
}
