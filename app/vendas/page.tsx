"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/cliente";
import { chamarApi } from "@/lib/chamar-api";
import Organograma from "@/components/Organograma";
import LinhaDoTempo from "@/components/LinhaDoTempo";
import FilaAprovacao from "@/components/FilaAprovacao";

type StatusPedido =
  | "novo"
  | "processando"
  | "aguardando_aprovacao"
  | "respondido"
  | "rejeitado";

type Pedido = {
  cod_pedido: string;
  data: string;
  cod_cliente: string;
  canal: string;
  mensagem: string;
  status: StatusPedido;
};

type Cliente = {
  cod_cliente: string;
  nome: string;
};

type Aba = "pedidos" | "aprovacoes";

const COLUNAS: { chave: StatusPedido; titulo: string }[] = [
  { chave: "novo", titulo: "Novo" },
  { chave: "processando", titulo: "Processando" },
  { chave: "aguardando_aprovacao", titulo: "Aguardando aprovação" },
  { chave: "respondido", titulo: "Respondido" },
  { chave: "rejeitado", titulo: "Rejeitado" },
];

const CANAIS = ["e-mail", "whatsapp", "telefone"];

// Proximo cod_pedido sequencial (PED031, PED032...) a partir do maior
// numero ja usado. Codigo determinístico, sem modelo (CLAUDE.md).
function proximoCodPedido(pedidos: Pedido[]): string {
  const maior = pedidos.reduce((max, p) => {
    const numero = parseInt(p.cod_pedido.replace(/\D/g, ""), 10);
    return Number.isFinite(numero) && numero > max ? numero : max;
  }, 0);
  return `PED${String(maior + 1).padStart(3, "0")}`;
}

export default function PaginaVendas() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [processando, setProcessando] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("pedidos");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [formCliente, setFormCliente] = useState("");
  const [formCanal, setFormCanal] = useState(CANAIS[0]);
  const [formMensagem, setFormMensagem] = useState("");
  const [formErro, setFormErro] = useState<string | null>(null);
  const [formEnviando, setFormEnviando] = useState(false);

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
      if (!corpo.perfil?.areas?.includes("vendas")) {
        router.replace("/");
        return;
      }

      const supabaseNav = criarClienteNavegador();
      const [{ data: pedidosData }, { data: clientesData }] = await Promise.all([
        supabaseNav
          .from("pedidos_orcamentos")
          .select("cod_pedido, data, cod_cliente, canal, mensagem, status")
          .order("data", { ascending: false }),
        supabaseNav.from("Clientes").select("cod_cliente, nome").order("nome"),
      ]);

      if (!ativo) return;

      if (pedidosData) setPedidos(pedidosData as Pedido[]);
      if (clientesData) setClientes(clientesData as Cliente[]);

      setAutorizado(true);
      setCarregando(false);
    }

    verificar();
    return () => {
      ativo = false;
    };
  }, [router]);

  // Kanban atualiza por Realtime na tabela pedidos_orcamentos (SPEC 4.1).
  useEffect(() => {
    if (!autorizado) return;

    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel("pedidos_orcamentos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_orcamentos" },
        (payload) => {
          setPedidos((atual) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as Pedido, ...atual];
            }
            if (payload.eventType === "UPDATE") {
              const novo = payload.new as Pedido;
              return atual.map((p) => (p.cod_pedido === novo.cod_pedido ? novo : p));
            }
            if (payload.eventType === "DELETE") {
              const antigo = payload.old as Pedido;
              return atual.filter((p) => p.cod_pedido !== antigo.cod_pedido);
            }
            return atual;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [autorizado]);

  async function processar(codPedido: string) {
    setErro(null);
    setSelecionado(codPedido);
    setProcessando((atual) => new Set(atual).add(codPedido));

    const resp = await chamarApi("/api/vendas/processar", {
      method: "POST",
      body: JSON.stringify({ cod_pedido: codPedido }),
    });

    setProcessando((atual) => {
      const novo = new Set(atual);
      novo.delete(codPedido);
      return novo;
    });

    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      setErro(corpo.erro ?? "Falha ao processar pedido.");
    }
  }

  async function criarPedido(evento: React.FormEvent) {
    evento.preventDefault();
    setFormErro(null);

    if (!formCliente || !formCanal || !formMensagem.trim()) {
      setFormErro("Preencha cliente, canal e mensagem.");
      return;
    }

    setFormEnviando(true);
    const supabase = criarClienteNavegador();
    const { error } = await supabase.from("pedidos_orcamentos").insert({
      cod_pedido: proximoCodPedido(pedidos),
      data: new Date().toISOString().slice(0, 10),
      cod_cliente: formCliente,
      canal: formCanal,
      mensagem: formMensagem.trim(),
      status: "novo",
    });
    setFormEnviando(false);

    if (error) {
      setFormErro(error.message);
      return;
    }

    // O cartao novo entra no kanban sozinho via Realtime (INSERT acima).
    setFormCliente("");
    setFormCanal(CANAIS[0]);
    setFormMensagem("");
    setMostrarForm(false);
  }

  // Decisao na fila de aprovacao (SPEC 4.3): aprovar/editar responde o
  // pedido; rejeitar devolve. item_id da aprovacao = cod_pedido.
  async function aplicarDecisaoAprovacao(
    item: { item_id: string },
    status: "aprovada" | "editada" | "rejeitada"
  ) {
    const supabase = criarClienteNavegador();
    const novoStatus = status === "rejeitada" ? "rejeitado" : "respondido";
    const { error } = await supabase
      .from("pedidos_orcamentos")
      .update({ status: novoStatus })
      .eq("cod_pedido", item.item_id);
    if (error) throw error;
  }

  if (carregando || !autorizado) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 p-8 dark:bg-black">
      <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Vendas</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Organograma{selecionado ? ` · ${selecionado}` : ""}
        </h2>
        <Organograma area="vendas" itemId={selecionado} />
      </section>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      <div className="flex gap-4 border-b border-black/[.08] dark:border-white/[.145]">
        {(
          [
            { chave: "pedidos", titulo: "Pedidos" },
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

      {aba === "aprovacoes" ? (
        <FilaAprovacao area="vendas" aoDecidir={aplicarDecisaoAprovacao} />
      ) : (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setMostrarForm((v) => !v)}
              className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {mostrarForm ? "Cancelar" : "Novo pedido"}
            </button>
          </div>

          {mostrarForm && (
            <form
              onSubmit={criarPedido}
              className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Cliente
                  <select
                    value={formCliente}
                    onChange={(e) => setFormCliente(e.target.value)}
                    className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                  >
                    <option value="">Selecione...</option>
                    {clientes.map((c) => (
                      <option key={c.cod_cliente} value={c.cod_cliente}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Canal
                  <select
                    value={formCanal}
                    onChange={(e) => setFormCanal(e.target.value)}
                    className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                  >
                    {CANAIS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Mensagem
                <textarea
                  value={formMensagem}
                  onChange={(e) => setFormMensagem(e.target.value)}
                  rows={3}
                  className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
                />
              </label>

              {formErro && <p className="text-sm text-red-600 dark:text-red-400">{formErro}</p>}

              <button
                type="submit"
                disabled={formEnviando}
                className="self-start rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {formEnviando ? "Salvando..." : "Salvar pedido"}
              </button>
            </form>
          )}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map((coluna) => {
              const itens = pedidos.filter((p) => p.status === coluna.chave);
              return (
                <div key={coluna.chave} className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {coluna.titulo} ({itens.length})
                  </h3>
                  <div className="flex flex-col gap-2">
                    {itens.map((pedido) => (
                      <div
                        key={pedido.cod_pedido}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelecionado(pedido.cod_pedido)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setSelecionado(pedido.cod_pedido);
                        }}
                        className={`flex cursor-pointer flex-col gap-1 rounded-lg border bg-white p-3 text-left text-xs dark:bg-zinc-950 ${
                          selecionado === pedido.cod_pedido
                            ? "border-black dark:border-white"
                            : "border-black/[.08] dark:border-white/[.145]"
                        }`}
                      >
                        <span className="font-medium text-black dark:text-zinc-50">
                          {pedido.cod_pedido}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {clientes.find((c) => c.cod_cliente === pedido.cod_cliente)?.nome ??
                            pedido.cod_cliente}
                        </span>
                        <span className="text-zinc-500 dark:text-zinc-500">
                          {pedido.canal} · {pedido.data}
                        </span>
                        <span className="text-zinc-500 dark:text-zinc-500">
                          {pedido.mensagem.slice(0, 80)}
                          {pedido.mensagem.length > 80 ? "…" : ""}
                        </span>
                        {pedido.status === "novo" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              processar(pedido.cod_pedido);
                            }}
                            disabled={processando.has(pedido.cod_pedido)}
                            className="mt-1 self-start rounded bg-black px-2 py-1 text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                          >
                            {processando.has(pedido.cod_pedido) ? "Processando..." : "Processar"}
                          </button>
                        )}
                      </div>
                    ))}
                    {itens.length === 0 && <p className="text-xs text-zinc-400">Vazio.</p>}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      {selecionado && (
        <div className="fixed inset-y-0 right-0 z-10 w-full max-w-md overflow-y-auto border-l border-black/[.08] bg-white p-6 shadow-lg dark:border-white/[.145] dark:bg-zinc-950">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
              {selecionado}
            </h2>
            <button
              onClick={() => setSelecionado(null)}
              className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Fechar
            </button>
          </div>
          <LinhaDoTempo itemId={selecionado} />
        </div>
      )}
    </div>
  );
}
