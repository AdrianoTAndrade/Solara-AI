"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/cliente";

type StatusAprovacao = "pendente" | "aprovada" | "editada" | "rejeitada";

type Aprovacao = {
  id: string;
  area: string;
  item_tipo: string;
  item_id: string;
  titulo: string;
  proposta: unknown;
  status: StatusAprovacao;
  decidido_por: string | null;
  decidido_em: string | null;
  observacao: string | null;
};

type Props = {
  area: "vendas" | "financeiro";
  // Chamado depois que a decisao e gravada em aprovacoes, para a tela da
  // area aplicar os efeitos proprios dela (SPEC 4.3 / 5.5): mover o pedido
  // ou a divergencia de status, atualizar titulos, etc. Opcional — sem ele,
  // o componente so decide na fila mesmo, como antes.
  aoDecidir?: (
    item: Aprovacao,
    status: "aprovada" | "editada" | "rejeitada",
    observacao: string
  ) => void | Promise<void>;
};

// Formatos de proposta que este componente sabe reconhecer e mostrar de
// forma legivel. Qualquer outro formato (ex.: Financeiro, quando existir)
// cai no modo generico (JSON bruto editavel), sem quebrar nada.
type ItemContexto = {
  descricao_cliente?: string;
  quantidade?: number | null;
  unidade?: string;
  existe?: boolean;
};

type PropostaComResposta = {
  resposta: string;
  contexto?: { itens?: ItemContexto[] };
  revisao?: { aprovado?: boolean; motivos?: string[] };
};

type PropostaTriagem = {
  tipo: string;
  itens?: ItemContexto[];
  observacoes?: string;
};

function ehPropostaComResposta(proposta: unknown): proposta is PropostaComResposta {
  return (
    typeof proposta === "object" &&
    proposta !== null &&
    typeof (proposta as { resposta?: unknown }).resposta === "string"
  );
}

function ehPropostaTriagem(proposta: unknown): proposta is PropostaTriagem {
  return (
    typeof proposta === "object" &&
    proposta !== null &&
    typeof (proposta as { tipo?: unknown }).tipo === "string" &&
    !("resposta" in (proposta as object))
  );
}

const ROTULO_TIPO_TRIAGEM: Record<string, string> = {
  fora_do_ramo: "🚫 Cliente pediu algo que a Solara não vende.",
  spam: "🗑️ Classificado como spam / propaganda.",
  reclamacao: "⚠️ É uma reclamação, não um pedido de orçamento.",
  outro: "❓ Não identificado como pedido de orçamento.",
};

// Componente publico: so repassa a area. Uma troca de area remonta
// FilaAprovacaoCarregada (via key), que assim ja nasce com estado limpo —
// sem precisar resetar via setState dentro de efeito.
export default function FilaAprovacao({ area, aoDecidir }: Props) {
  return <FilaAprovacaoCarregada key={area} area={area} aoDecidir={aoDecidir} />;
}

function FilaAprovacaoCarregada({ area, aoDecidir }: Props) {
  const [itens, setItens] = useState<Aprovacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [textoProposta, setTextoProposta] = useState("");
  const [textoResposta, setTextoResposta] = useState("");
  const [observacao, setObservacao] = useState("");
  const [mostrarRejeicao, setMostrarRejeicao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const selecionado = itens.find((i) => i.id === selecionadoId) ?? null;

  async function carregar() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase
      .from("aprovacoes")
      .select("*")
      .eq("area", area)
      .eq("status", "pendente");

    if (!error && data) setItens(data as Aprovacao[]);
    setCarregando(false);
  }

  useEffect(() => {
    // carregar() roda dentro do callback do setTimeout (nao direto no corpo
    // do efeito), pois tambem e reaproveitada por decidir() e o linter nao
    // enxerga que os setState internos ficam depois do await.
    const chamada = setTimeout(carregar, 0);
    return () => clearTimeout(chamada);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  function selecionar(item: Aprovacao) {
    setSelecionadoId(item.id);
    setTextoProposta(JSON.stringify(item.proposta, null, 2));
    setTextoResposta(ehPropostaComResposta(item.proposta) ? item.proposta.resposta : "");
    setObservacao("");
    setMostrarRejeicao(false);
    setErro(null);
  }

  async function decidir(
    status: "aprovada" | "editada" | "rejeitada",
    proposta?: unknown
  ) {
    if (!selecionado) return;
    setErro(null);
    setEnviando(true);

    const supabase = criarClienteNavegador();
    const { data: usuario } = await supabase.auth.getUser();

    const atualizacao: Record<string, unknown> = {
      status,
      decidido_por: usuario.user?.id ?? null,
      decidido_em: new Date().toISOString(),
    };
    if (proposta !== undefined) atualizacao.proposta = proposta;
    if (status === "rejeitada") atualizacao.observacao = observacao;

    const { error } = await supabase
      .from("aprovacoes")
      .update(atualizacao)
      .eq("id", selecionado.id);

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    if (aoDecidir) {
      try {
        await aoDecidir(selecionado, status, observacao);
      } catch (erroEfeito) {
        const mensagem = erroEfeito instanceof Error ? erroEfeito.message : String(erroEfeito);
        setErro(`Decisão gravada, mas falhou ao aplicar o efeito: ${mensagem}`);
      }
    }

    setSelecionadoId(null);
    await carregar();
  }

  async function aprovar() {
    await decidir("aprovada");
  }

  async function salvarEdicaoEAprovar() {
    if (!selecionado) return;

    if (ehPropostaComResposta(selecionado.proposta)) {
      await decidir("editada", { ...selecionado.proposta, resposta: textoResposta });
      return;
    }

    let propostaEditada: unknown;
    try {
      propostaEditada = JSON.parse(textoProposta);
    } catch {
      setErro("A proposta editada nao e um JSON valido.");
      return;
    }
    await decidir("editada", propostaEditada);
  }

  async function rejeitar() {
    if (!mostrarRejeicao) {
      setMostrarRejeicao(true);
      return;
    }
    if (!observacao.trim()) {
      setErro("Descreva o motivo da rejeicao.");
      return;
    }
    await decidir("rejeitada");
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex-1 rounded-lg border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
        <div className="border-b border-black/[.08] px-4 py-2 text-sm font-medium text-black dark:border-white/[.145] dark:text-zinc-50">
          Pendentes ({itens.length})
        </div>
        {carregando ? (
          <p className="px-4 py-4 text-sm text-zinc-400">Carregando...</p>
        ) : itens.length === 0 ? (
          <p className="px-4 py-4 text-sm text-zinc-400">Nenhum item pendente.</p>
        ) : (
          <ul>
            {itens.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => selecionar(item)}
                  className={`w-full border-b border-black/[.05] px-4 py-3 text-left text-sm last:border-0 hover:bg-zinc-50 dark:border-white/[.08] dark:hover:bg-zinc-900 ${
                    selecionadoId === item.id ? "bg-zinc-100 dark:bg-zinc-900" : ""
                  }`}
                >
                  <div className="font-medium text-black dark:text-zinc-50">{item.titulo}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {item.item_tipo} · {item.item_id}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex-1 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
        {!selecionado ? (
          <p className="text-sm text-zinc-400">Selecione um item pendente para ver a proposta.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-black dark:text-zinc-50">{selecionado.titulo}</h3>

            {ehPropostaTriagem(selecionado.proposta) && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <p className="font-medium">
                  {ROTULO_TIPO_TRIAGEM[selecionado.proposta.tipo] ??
                    `Classificado como "${selecionado.proposta.tipo}", não é um pedido de orçamento.`}
                </p>
                {selecionado.proposta.observacoes && (
                  <p className="mt-1 text-amber-800 dark:text-amber-400">
                    {selecionado.proposta.observacoes}
                  </p>
                )}
              </div>
            )}

            {ehPropostaComResposta(selecionado.proposta) && (
              <>
                {(selecionado.proposta.contexto?.itens ?? []).filter((item) => item.existe === false)
                  .length > 0 && (
                  <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    <p className="font-medium">⚠️ Itens que não vendemos / não identificados no catálogo:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {(selecionado.proposta.contexto?.itens ?? [])
                        .filter((item) => item.existe === false)
                        .map((item, indice) => (
                          <li key={indice}>
                            {item.descricao_cliente ?? "item"}
                            {item.quantidade ? ` — ${item.quantidade} ${item.unidade ?? ""}` : ""}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {selecionado.proposta.revisao?.aprovado === false && (
                  <div className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                    <p className="font-medium">O Revisor reprovou esta resposta. Motivos:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {(selecionado.proposta.revisao?.motivos ?? []).map((motivo, indice) => (
                        <li key={indice}>{motivo}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Resposta ao cliente (editável)
                  <textarea
                    value={textoResposta}
                    onChange={(e) => setTextoResposta(e.target.value)}
                    rows={12}
                    className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                  />
                </label>

                <details className="text-xs text-zinc-500 dark:text-zinc-400">
                  <summary className="cursor-pointer">Ver detalhes técnicos (JSON)</summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-black dark:bg-zinc-900 dark:text-zinc-50">
                    {JSON.stringify(selecionado.proposta, null, 2)}
                  </pre>
                </details>
              </>
            )}

            {!ehPropostaComResposta(selecionado.proposta) && !ehPropostaTriagem(selecionado.proposta) && (
              <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                Proposta (editável)
                <textarea
                  value={textoProposta}
                  onChange={(e) => setTextoProposta(e.target.value)}
                  rows={12}
                  className="rounded border border-black/[.08] bg-transparent px-3 py-2 font-mono text-xs text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                />
              </label>
            )}

            {mostrarRejeicao && (
              <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                Motivo da rejeição
                <textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={3}
                  className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-xs text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                />
              </label>
            )}

            {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={aprovar}
                disabled={enviando}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Aprovar
              </button>
              {!ehPropostaTriagem(selecionado.proposta) && (
                <button
                  onClick={salvarEdicaoEAprovar}
                  disabled={enviando}
                  className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  Salvar edição e aprovar
                </button>
              )}
              <button
                onClick={rejeitar}
                disabled={enviando}
                className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                {mostrarRejeicao ? "Confirmar rejeição" : "Rejeitar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
