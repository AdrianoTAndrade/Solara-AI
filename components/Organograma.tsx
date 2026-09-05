"use client";

import { useEffect, useRef, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/cliente";

type StatusExecucao = "rodando" | "ok" | "erro";

type Execucao = {
  id: string;
  area: string;
  item_tipo: string;
  item_id: string;
  agente: string;
  chamado_por: string | null;
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
  area: "vendas" | "financeiro";
  itemId: string | null;
};

const AGENTES_POR_AREA: Record<Props["area"], string[]> = {
  vendas: ["triador", "pesquisador", "redator", "revisor"],
  financeiro: ["investigador", "consolidador", "revisor"],
};

function ultimaExecucao(execucoes: Execucao[], papel: string): Execucao | undefined {
  return execucoes
    .filter((e) => e.agente === papel)
    .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0];
}

// Componente publico: so decide se ha item selecionado. Uma troca de itemId
// remonta OrganogramaCarregado (via key), que assim ja nasce com estado
// limpo — sem precisar resetar via setState dentro de efeito.
export default function Organograma({ area, itemId }: Props) {
  if (!itemId) {
    return (
      <div className="flex flex-col items-center gap-0 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
        <p className="py-8 text-sm text-zinc-400">Nenhum item selecionado.</p>
      </div>
    );
  }

  return <OrganogramaCarregado key={itemId} area={area} itemId={itemId} />;
}

function OrganogramaCarregado({ area, itemId }: { area: Props["area"]; itemId: string }) {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [retrabalho, setRetrabalho] = useState(false);
  const ultimoRevisorProcessado = useRef<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const supabase = criarClienteNavegador();

    async function carregarInicial() {
      const { data } = await supabase
        .from("execucoes_agentes")
        .select("*")
        .eq("item_id", itemId)
        .order("inicio", { ascending: true });
      if (ativo && data) setExecucoes(data as Execucao[]);
    }

    carregarInicial();

    const canal = supabase
      .channel(`execucoes_agentes:${itemId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "execucoes_agentes",
          filter: `item_id=eq.${itemId}`,
        },
        (payload) => {
          setExecucoes((atual) => {
            if (payload.eventType === "INSERT") {
              return [...atual, payload.new as Execucao];
            }
            if (payload.eventType === "UPDATE") {
              const nova = payload.new as Execucao;
              return atual.map((e) => (e.id === nova.id ? nova : e));
            }
            if (payload.eventType === "DELETE") {
              const antiga = payload.old as Execucao;
              return atual.filter((e) => e.id !== antiga.id);
            }
            return atual;
          });
        }
      )
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [itemId]);

  // Revisor reprovou (aprovado = false): seta revisor -> redator fica vermelha por 3s.
  useEffect(() => {
    if (area !== "vendas") return;

    const ultimo = ultimaExecucao(
      execucoes.filter((e) => e.status === "ok"),
      "revisor"
    );
    if (!ultimo || ultimo.id === ultimoRevisorProcessado.current) return;

    ultimoRevisorProcessado.current = ultimo.id;
    const saida = ultimo.saida as { aprovado?: boolean } | null;

    if (saida?.aprovado === false) {
      // setState roda dentro do callback do setTimeout (nao direto no corpo
      // do efeito) para nao disparar um re-render em cascata na mesma
      // atualizacao que trouxe a saida do revisor pelo Realtime.
      const ligar = setTimeout(() => setRetrabalho(true), 0);
      const desligar = setTimeout(() => setRetrabalho(false), 3000);
      return () => {
        clearTimeout(ligar);
        clearTimeout(desligar);
      };
    }
  }, [execucoes, area]);

  const execucaoOrquestrador = ultimaExecucao(execucoes, "orquestrador");
  const agentesDaArea = AGENTES_POR_AREA[area];

  const execucoesInvestigador = execucoes.filter((e) => e.agente === "investigador");
  const contagemInvestigador = {
    rodando: execucoesInvestigador.filter((e) => e.status === "rodando").length,
    concluidos: execucoesInvestigador.filter((e) => e.status !== "rodando").length,
  };

  return (
    <div className="flex flex-col items-center gap-0 rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
      <CartaoAgente nome="orquestrador" execucao={execucaoOrquestrador} />
      <div className="h-6 w-0.5 bg-zinc-300 dark:bg-zinc-700" />
      <div className="flex justify-center gap-8 border-t-2 border-zinc-300 pt-6 dark:border-zinc-700">
        {agentesDaArea.map((nomeAgente) => {
          const destaque =
            retrabalho && (nomeAgente === "redator" || nomeAgente === "revisor");
          const stemClasse = destaque ? "bg-red-500" : "bg-zinc-300 dark:bg-zinc-700";

          return (
            <div key={nomeAgente} className="relative flex flex-col items-center">
              <div
                className={`absolute -top-6 h-6 w-0.5 transition-colors duration-300 ${stemClasse}`}
              />
              {nomeAgente === "investigador" && area === "financeiro" ? (
                <CartaoAgente nome={nomeAgente} contagem={contagemInvestigador} />
              ) : (
                <CartaoAgente
                  nome={nomeAgente}
                  execucao={ultimaExecucao(execucoes, nomeAgente)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartaoAgente({
  nome,
  execucao,
  contagem,
}: {
  nome: string;
  execucao?: Execucao;
  contagem?: { rodando: number; concluidos: number };
}) {
  const status = execucao?.status;

  const corBase = contagem
    ? contagem.rodando > 0
      ? "bg-amber-100 border-amber-400 animate-pulse dark:bg-amber-950 dark:border-amber-600"
      : "bg-emerald-100 border-emerald-400 dark:bg-emerald-950 dark:border-emerald-600"
    : status === "rodando"
      ? "bg-amber-100 border-amber-400 animate-pulse dark:bg-amber-950 dark:border-amber-600"
      : status === "ok"
        ? "bg-emerald-100 border-emerald-400 dark:bg-emerald-950 dark:border-emerald-600"
        : status === "erro"
          ? "bg-red-100 border-red-400 dark:bg-red-950 dark:border-red-600"
          : "bg-zinc-100 border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700";

  const tempoSegundos =
    execucao?.fim && execucao?.inicio
      ? ((new Date(execucao.fim).getTime() - new Date(execucao.inicio).getTime()) / 1000).toFixed(1)
      : null;

  const totalTokens =
    execucao && (execucao.tokens_entrada !== null || execucao.tokens_saida !== null)
      ? (execucao.tokens_entrada ?? 0) + (execucao.tokens_saida ?? 0)
      : null;

  return (
    <div className={`w-32 rounded-lg border-2 px-3 py-2 text-center text-xs ${corBase}`}>
      <div className="font-medium capitalize text-black dark:text-zinc-50">{nome}</div>

      {contagem ? (
        <div className="mt-1 text-zinc-600 dark:text-zinc-400">
          {contagem.rodando} rodando / {contagem.concluidos} concluídos
        </div>
      ) : status === "ok" ? (
        <div className="mt-1 text-zinc-600 dark:text-zinc-400">
          {tempoSegundos}s · {totalTokens} tok
        </div>
      ) : status === "erro" ? (
        <div className="mt-1 text-red-700 dark:text-red-300">erro</div>
      ) : status === "rodando" ? (
        <div className="mt-1 text-zinc-600 dark:text-zinc-400">rodando...</div>
      ) : (
        <div className="mt-1 text-zinc-400 dark:text-zinc-600">—</div>
      )}
    </div>
  );
}
