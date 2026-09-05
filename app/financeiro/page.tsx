"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/cliente";
import { chamarApi } from "@/lib/chamar-api";
import Organograma from "@/components/Organograma";
import LinhaDoTempo from "@/components/LinhaDoTempo";
import FilaAprovacao from "@/components/FilaAprovacao";

type Extrato = { id: string; nome_arquivo: string; importado_em: string };

type Lancamento = {
  id: string;
  extrato_id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: "credito" | "debito";
  cod_titulo_casado: string | null;
  situacao: "casado" | "divergente" | "ignorado";
};

type StatusDivergencia = "nova" | "investigando" | "aguardando_aprovacao" | "resolvida";

type Divergencia = {
  id: string;
  extrato_id: string;
  tipo_inicial: string;
  lancamento_id: string | null;
  cod_titulo: string | null;
  valor_lancamento: number | null;
  valor_titulo: number | null;
  status: StatusDivergencia;
  hipotese: {
    hipotese?: string;
    cod_titulos_envolvidos?: string[];
    valor_a_baixar?: number;
    valor_pendente?: number;
  } | null;
};

type Relatorio = { relatorio_markdown: string; acoes: string[] };

type Aba = "resultado" | "relatorio" | "aprovacoes";

const COLUNAS_DIVERGENCIA: { chave: StatusDivergencia; titulo: string }[] = [
  { chave: "nova", titulo: "Nova" },
  { chave: "investigando", titulo: "Investigando" },
  { chave: "aguardando_aprovacao", titulo: "Aguardando aprovação" },
  { chave: "resolvida", titulo: "Resolvida" },
];

function formatarReal(valor: number | null): string {
  if (valor === null) return "—";
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

export default function PaginaFinanceiro() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("resultado");

  const [extratoAtual, setExtratoAtual] = useState<Extrato | null>(null);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);

  const [antes, setAntes] = useState<string[] | null>(null);
  const [depois, setDepois] = useState<string[] | null>(null);
  const [resumoImportacao, setResumoImportacao] = useState<{
    qtd_casados: number;
    valor_casado: number;
    qtd_divergencias: number;
    valor_divergente: number;
  } | null>(null);

  const [importando, setImportando] = useState(false);
  const [conciliando, setConciliando] = useState(false);
  const arquivoExtratoRef = useRef<HTMLInputElement>(null);
  const arquivoTitulosRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ativo = true;
    const supabase = criarClienteNavegador();

    async function verificar() {
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
      if (!corpo.perfil?.areas?.includes("financeiro")) {
        router.replace("/");
        return;
      }

      const supabaseNav = criarClienteNavegador();
      const { data: ultimoExtrato } = await supabaseNav
        .from("extratos_importados")
        .select("id, nome_arquivo, importado_em")
        .order("importado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ativo) return;

      if (ultimoExtrato) {
        setExtratoAtual(ultimoExtrato as Extrato);
        await carregarDadosDoExtrato((ultimoExtrato as Extrato).id);
      }

      setAutorizado(true);
      setCarregando(false);
    }

    verificar();
    return () => {
      ativo = false;
    };
  }, [router]);

  async function carregarDadosDoExtrato(extratoId: string) {
    const supabase = criarClienteNavegador();
    const [{ data: lancamentosData }, { data: divergenciasData }, { data: execucaoConsolidador }] =
      await Promise.all([
        supabase.from("lancamentos").select("*").eq("extrato_id", extratoId),
        supabase.from("divergencias").select("*").eq("extrato_id", extratoId),
        supabase
          .from("execucoes_agentes")
          .select("saida")
          .eq("item_id", extratoId)
          .eq("agente", "consolidador")
          .eq("status", "ok")
          .order("inicio", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (lancamentosData) setLancamentos(lancamentosData as Lancamento[]);
    if (divergenciasData) setDivergencias(divergenciasData as Divergencia[]);
    if (execucaoConsolidador?.saida) setRelatorio(execucaoConsolidador.saida as Relatorio);
  }

  // Realtime nas duas tabelas, filtrado pelo extrato atual (SPEC 5: a tela
  // acompanha a conciliacao ao vivo).
  useEffect(() => {
    if (!extratoAtual) return;

    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel(`financeiro:${extratoAtual.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lancamentos", filter: `extrato_id=eq.${extratoAtual.id}` },
        (payload) => {
          setLancamentos((atual) => {
            if (payload.eventType === "INSERT") return [...atual, payload.new as Lancamento];
            if (payload.eventType === "UPDATE") {
              const novo = payload.new as Lancamento;
              return atual.map((l) => (l.id === novo.id ? novo : l));
            }
            return atual;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "divergencias", filter: `extrato_id=eq.${extratoAtual.id}` },
        (payload) => {
          setDivergencias((atual) => {
            if (payload.eventType === "INSERT") return [...atual, payload.new as Divergencia];
            if (payload.eventType === "UPDATE") {
              const novo = payload.new as Divergencia;
              return atual.map((d) => (d.id === novo.id ? novo : d));
            }
            return atual;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [extratoAtual]);

  async function importar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    const arquivoExtrato = arquivoExtratoRef.current?.files?.[0];
    if (!arquivoExtrato) {
      setErro("Selecione o arquivo do extrato.");
      return;
    }

    const formData = new FormData();
    formData.append("extrato", arquivoExtrato);
    const arquivoTitulos = arquivoTitulosRef.current?.files?.[0];
    if (arquivoTitulos) formData.append("titulos", arquivoTitulos);

    setImportando(true);
    const resp = await chamarApi("/api/financeiro/importar", { method: "POST", body: formData });
    const corpo = await resp.json();
    setImportando(false);

    if (!resp.ok) {
      setErro(corpo.erro ?? "Falha ao importar o extrato.");
      return;
    }

    setExtratoAtual(corpo.extrato);
    setAntes(corpo.antes);
    setDepois(corpo.depois);
    setResumoImportacao(corpo.resumo);
    setRelatorio(null);
    await carregarDadosDoExtrato(corpo.extrato.id);

    if (arquivoExtratoRef.current) arquivoExtratoRef.current.value = "";
    if (arquivoTitulosRef.current) arquivoTitulosRef.current.value = "";
  }

  async function conciliar() {
    if (!extratoAtual) return;
    setErro(null);
    setConciliando(true);

    const resp = await chamarApi("/api/financeiro/conciliar", {
      method: "POST",
      body: JSON.stringify({ extrato_id: extratoAtual.id }),
    });
    const corpo = await resp.json();
    setConciliando(false);

    if (!resp.ok) {
      setErro(corpo.erro ?? "Falha ao conciliar.");
      return;
    }

    setRelatorio(corpo.relatorio);
  }

  // Decisao na fila de aprovacao (SPEC 5.5): aprovar/editar resolve a
  // divergencia e atualiza o(s) titulo(s) envolvidos; rejeitar devolve a
  // divergencia para "nova" com a observacao.
  async function aplicarDecisaoAprovacao(
    item: { item_id: string; proposta: unknown },
    status: "aprovada" | "editada" | "rejeitada",
    observacao: string
  ) {
    const supabase = criarClienteNavegador();

    if (status === "rejeitada") {
      const { error } = await supabase
        .from("divergencias")
        .update({ status: "nova" })
        .eq("id", item.item_id);
      if (error) throw error;
      return;
    }

    const { error: erroDivergencia } = await supabase
      .from("divergencias")
      .update({ status: "resolvida" })
      .eq("id", item.item_id);
    if (erroDivergencia) throw erroDivergencia;

    const proposta = item.proposta as { hipotese?: { hipotese?: string; valor_pendente?: number; cod_titulos_envolvidos?: string[] } } | null;
    const codTitulos = proposta?.hipotese?.cod_titulos_envolvidos ?? [];
    if (codTitulos.length === 0) return;

    const statusTitulo =
      proposta?.hipotese?.hipotese === "vencido_sem_pagamento"
        ? "vencido"
        : (proposta?.hipotese?.valor_pendente ?? 0) > 0
          ? "pago_parcial"
          : "pago";

    const { error: erroTitulos } = await supabase
      .from("titulos_receber")
      .update({ status: statusTitulo })
      .in("cod_titulo", codTitulos);
    if (erroTitulos) throw erroTitulos;

    void observacao;
  }

  if (carregando || !autorizado) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  const bateram = lancamentos.filter((l) => l.situacao === "casado");
  const ignorados = lancamentos.filter((l) => l.situacao === "ignorado");

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 p-8 dark:bg-black">
      <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Financeiro</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Organograma{extratoAtual ? ` · ${extratoAtual.nome_arquivo}` : ""}
        </h2>
        <Organograma area="financeiro" itemId={extratoAtual?.id ?? null} />
      </section>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      <section className="flex flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
        <form onSubmit={importar} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Extrato bancário (obrigatório)
              <input
                ref={arquivoExtratoRef}
                type="file"
                accept=".csv"
                className="text-sm text-black file:mr-2 file:rounded file:border-0 file:bg-black file:px-3 file:py-1 file:text-white dark:text-zinc-50 dark:file:bg-white dark:file:text-black"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Títulos (opcional — senão usa titulos_receber)
              <input
                ref={arquivoTitulosRef}
                type="file"
                accept=".csv"
                className="text-sm text-black file:mr-2 file:rounded file:border-0 file:bg-black file:px-3 file:py-1 file:text-white dark:text-zinc-50 dark:file:bg-white dark:file:text-black"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={importando}
            className="self-start rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {importando ? "Importando..." : "Importar"}
          </button>
        </form>

        {antes && depois && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                Antes (como veio)
              </h3>
              <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-black dark:bg-zinc-900 dark:text-zinc-50">
                {antes.join("\n")}
              </pre>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                Depois (normalizado)
              </h3>
              <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-black dark:bg-zinc-900 dark:text-zinc-50">
                {depois.join("\n")}
              </pre>
            </div>
          </div>
        )}

        {resumoImportacao && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {resumoImportacao.qtd_casados} casados ({formatarReal(resumoImportacao.valor_casado)}) ·{" "}
            {resumoImportacao.qtd_divergencias} divergências ({formatarReal(resumoImportacao.valor_divergente)})
          </p>
        )}

        {extratoAtual && (
          <button
            type="button"
            onClick={conciliar}
            disabled={conciliando}
            className="self-start rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {conciliando ? "Conciliando..." : "Conciliar"}
          </button>
        )}
      </section>

      {extratoAtual && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Linha do tempo da conciliação</h2>
          <div className="rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
            <LinhaDoTempo itemId={extratoAtual.id} />
          </div>
        </section>
      )}

      <div className="flex gap-4 border-b border-black/[.08] dark:border-white/[.145]">
        {(
          [
            { chave: "resultado", titulo: "Resultado" },
            { chave: "relatorio", titulo: "Relatório" },
            { chave: "aprovacoes", titulo: "Aprovações" },
          ] as { chave: Aba; titulo: string }[]
        ).map((item) => (
          <button
            key={item.chave}
            onClick={() => setAba(item.chave)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
              aba === item.chave
                ? "border-black text-black dark:border-white dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            {item.titulo}
          </button>
        ))}
      </div>

      {aba === "resultado" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Bateram ({bateram.length})
            </h3>
            <div className="flex flex-col gap-2">
              {bateram.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950"
                >
                  <div className="font-medium text-emerald-900 dark:text-emerald-300">{l.descricao}</div>
                  <div className="text-emerald-700 dark:text-emerald-400">
                    {formatarReal(l.valor)} · {l.data} · {l.cod_titulo_casado}
                  </div>
                </div>
              ))}
              {bateram.length === 0 && <p className="text-xs text-zinc-400">Vazio.</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Divergências ({divergencias.length})
            </h3>
            <div className="flex flex-col gap-3">
              {COLUNAS_DIVERGENCIA.map((coluna) => {
                const itens = divergencias.filter((d) => d.status === coluna.chave);
                return (
                  <div key={coluna.chave} className="flex flex-col gap-1">
                    <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {coluna.titulo} ({itens.length})
                    </h4>
                    <div className="flex flex-col gap-1">
                      {itens.map((d) => (
                        <div
                          key={d.id}
                          className="rounded border border-black/[.08] bg-white p-2 text-xs dark:border-white/[.145] dark:bg-zinc-950"
                        >
                          <div className="font-medium text-black dark:text-zinc-50">{d.tipo_inicial}</div>
                          <div className="text-zinc-500 dark:text-zinc-400">
                            {formatarReal(d.valor_lancamento ?? d.valor_titulo)}
                            {d.cod_titulo ? ` · ${d.cod_titulo}` : ""}
                          </div>
                        </div>
                      ))}
                      {itens.length === 0 && <p className="text-xs text-zinc-400">Vazio.</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Ignorados — débitos ({ignorados.length})
            </h3>
            <div className="flex flex-col gap-2">
              {ignorados.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-black/[.08] bg-white p-3 text-xs dark:border-white/[.145] dark:bg-zinc-950"
                >
                  <div className="font-medium text-black dark:text-zinc-50">{l.descricao}</div>
                  <div className="text-zinc-500 dark:text-zinc-400">
                    {formatarReal(l.valor)} · {l.data}
                  </div>
                </div>
              ))}
              {ignorados.length === 0 && <p className="text-xs text-zinc-400">Vazio.</p>}
            </div>
          </div>
        </section>
      )}

      {aba === "relatorio" &&
        (relatorio ? (
          <article className="whitespace-pre-wrap rounded-lg border border-black/[.08] bg-white p-4 text-sm text-black dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50">
            {relatorio.relatorio_markdown}
          </article>
        ) : (
          <p className="text-sm text-zinc-400">Ainda não há relatório. Importe e concilie um extrato.</p>
        ))}

      {aba === "aprovacoes" && (
        <FilaAprovacao area="financeiro" aoDecidir={aplicarDecisaoAprovacao} />
      )}
    </div>
  );
}
