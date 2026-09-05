"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/cliente";

type StatusExecucao = "rodando" | "ok" | "erro";

type Execucao = {
  id: string;
  agente: string;
  status: StatusExecucao;
  entrada: unknown;
  saida: unknown;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  inicio: string;
  fim: string | null;
};

type Props = {
  itemId: string | null;
};

// Componente publico: so decide se ha item selecionado. Uma troca de itemId
// remonta LinhaDoTempoCarregada (via key), que assim ja nasce com estado
// limpo — sem precisar resetar via setState dentro de efeito.
export default function LinhaDoTempo({ itemId }: Props) {
  if (!itemId) {
    return <p className="text-sm text-zinc-400">Nenhum item selecionado.</p>;
  }

  return <LinhaDoTempoCarregada key={itemId} itemId={itemId} />;
}

function LinhaDoTempoCarregada({ itemId }: { itemId: string }) {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const supabase = criarClienteNavegador();

    supabase
      .from("execucoes_agentes")
      .select("*")
      .eq("item_id", itemId)
      .order("inicio", { ascending: true })
      .then(({ data }) => {
        if (ativo) {
          setExecucoes((data as Execucao[]) ?? []);
          setCarregando(false);
        }
      });

    return () => {
      ativo = false;
    };
  }, [itemId]);

  if (carregando) {
    return <p className="text-sm text-zinc-400">Carregando...</p>;
  }

  if (execucoes.length === 0) {
    return <p className="text-sm text-zinc-400">Nenhuma execução registrada ainda.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {execucoes.map((execucao) => {
        const tempoSegundos =
          execucao.fim && execucao.inicio
            ? ((new Date(execucao.fim).getTime() - new Date(execucao.inicio).getTime()) / 1000).toFixed(1)
            : null;
        const totalTokens =
          execucao.tokens_entrada !== null || execucao.tokens_saida !== null
            ? (execucao.tokens_entrada ?? 0) + (execucao.tokens_saida ?? 0)
            : null;
        const expandido = expandidoId === execucao.id;

        return (
          <li
            key={execucao.id}
            className="rounded-lg border border-black/[.08] bg-white text-sm dark:border-white/[.145] dark:bg-zinc-950"
          >
            <button
              onClick={() => setExpandidoId(expandido ? null : execucao.id)}
              className="flex w-full items-center justify-between px-4 py-2 text-left"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    execucao.status === "ok"
                      ? "bg-emerald-500"
                      : execucao.status === "erro"
                        ? "bg-red-500"
                        : "bg-amber-500"
                  }`}
                />
                <span className="font-medium capitalize text-black dark:text-zinc-50">
                  {execucao.agente}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{execucao.status}</span>
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {tempoSegundos ? `${tempoSegundos}s` : "—"} · {totalTokens ?? "—"} tok
              </span>
            </button>

            {expandido && (
              <div className="border-t border-black/[.08] px-4 py-3 dark:border-white/[.145]">
                {execucao.erro && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400">{execucao.erro}</p>
                )}
                <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Entrada</p>
                <pre className="mb-3 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-black dark:bg-zinc-900 dark:text-zinc-50">
                  {JSON.stringify(execucao.entrada, null, 2)}
                </pre>
                <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Saída</p>
                <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-black dark:bg-zinc-900 dark:text-zinc-50">
                  {JSON.stringify(execucao.saida, null, 2)}
                </pre>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
