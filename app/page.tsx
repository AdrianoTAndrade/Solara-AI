"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/cliente";
import { chamarApi } from "@/lib/chamar-api";

type Perfil = {
  id: string;
  email: string;
  nome: string;
  papel: "admin" | "operador";
  areas: string[];
};

type Area = {
  chave: string;
  nome: string;
  href: string;
  disponivel: boolean;
};

const AREAS: Area[] = [
  { chave: "vendas", nome: "Vendas", href: "/vendas", disponivel: true },
  { chave: "financeiro", nome: "Financeiro", href: "/financeiro", disponivel: true },
  { chave: "rh", nome: "RH", href: "", disponivel: false },
  { chave: "juridico", nome: "Jurídico", href: "", disponivel: false },
  { chave: "operacoes", nome: "Operações", href: "", disponivel: false },
];

export default function PaginaInicial() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    const supabase = criarClienteNavegador();

    async function carregar() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.replace("/login");
        return;
      }

      const resp = await chamarApi("/api/perfil");
      if (!resp.ok) {
        router.replace("/login");
        return;
      }
      const corpo = await resp.json();
      if (ativo) {
        setPerfil(corpo.perfil);
        setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [router]);

  async function sair() {
    const supabase = criarClienteNavegador();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (carregando || !perfil) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <div>
          <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Solara OS</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{perfil.email}</p>
        </div>
        <div className="flex items-center gap-4">
          {perfil.papel === "admin" && (
            <Link
              href="/admin"
              className="text-sm font-medium text-black underline-offset-4 hover:underline dark:text-zinc-50"
            >
              Administração
            </Link>
          )}
          <button
            onClick={sair}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center p-8">
        <div className="grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
          {AREAS.map((area) => {
            const liberada = area.disponivel && perfil.areas.includes(area.chave);

            if (!area.disponivel) {
              return (
                <div
                  key={area.chave}
                  className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-black/[.1] text-zinc-400 dark:border-white/[.145] dark:text-zinc-600"
                >
                  <span className="text-sm font-medium">{area.nome}</span>
                  <span className="text-xs">em breve</span>
                </div>
              );
            }

            if (!liberada) {
              return null;
            }

            return (
              <Link
                key={area.chave}
                href={area.href}
                className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-black/[.08] bg-white text-black transition-colors hover:border-black/40 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50 dark:hover:border-white/40"
              >
                <span className="text-sm font-medium">{area.nome}</span>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
