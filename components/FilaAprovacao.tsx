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
};

export default function FilaAprovacao({ area }: Props) {
  const [itens, setItens] = useState<Aprovacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [textoProposta, setTextoProposta] = useState("");
  const [observacao, setObservacao] = useState("");
  const [mostrarRejeicao, setMostrarRejeicao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const selecionado = itens.find((i) => i.id === selecionadoId) ?? null;

  async function carregar() {
    setCarregando(true);
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
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  function selecionar(item: Aprovacao) {
    setSelecionadoId(item.id);
    setTextoProposta(JSON.stringify(item.proposta, null, 2));
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

    setSelecionadoId(null);
    await carregar();
  }

  async function aprovar() {
    await decidir("aprovada");
  }

  async function salvarEdicaoEAprovar() {
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

            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              Proposta (editável)
              <textarea
                value={textoProposta}
                onChange={(e) => setTextoProposta(e.target.value)}
                rows={12}
                className="rounded border border-black/[.08] bg-transparent px-3 py-2 font-mono text-xs text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
              />
            </label>

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
              <button
                onClick={salvarEdicaoEAprovar}
                disabled={enviando}
                className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Salvar edição e aprovar
              </button>
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
