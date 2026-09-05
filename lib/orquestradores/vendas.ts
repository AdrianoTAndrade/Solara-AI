import { criarClienteServidor } from "@/lib/supabase/servidor";
import { agente } from "@/lib/agente";

// Orquestrador de Vendas (SPEC 4.2). Codigo comum: decide a sequencia de
// agentes, o modelo nunca escolhe quem chamar (CLAUDE.md).

type TipoTriagem =
  | "orcamento"
  | "complemento"
  | "reclamacao"
  | "fora_do_ramo"
  | "spam"
  | "outro";

type ItemTriagem = {
  descricao_cliente: string;
  quantidade: number | null;
  unidade: string;
};

type SaidaTriador = {
  tipo: TipoTriagem;
  itens: ItemTriagem[];
  prazo_desejado: string | null;
  pede_desconto: boolean;
  desconto_pedido_pct: number | null;
  urgencia: "normal" | "alta" | "critica";
  observacoes: string;
};

type Produto = {
  cod_produto: string;
  descricao: string;
  unidade: string;
  preco_unitario: number;
  preco_acima_100_un: number;
  estoque: number;
  prazo_reposicao_dias: number;
};

type CandidatosPorItem = {
  descricao_cliente: string;
  candidatos: Produto[];
};

type Cliente = {
  cod_cliente: string;
  nome: string;
  segmento: string | null;
  prazo_pagamento_dias: number | null;
  desconto_maximo_pct: number | null;
  cliente_desde: string | null;
};

type PedidoAnterior = {
  cod_pedido: string;
  data: string;
  canal: string;
  mensagem: string;
  status: string;
};

type ItemContexto = {
  descricao_cliente: string;
  cod_produto: string | null;
  descricao: string | null;
  quantidade: number | null;
  unidade: string;
  existe: boolean;
  preco_aplicado: number | null;
  estoque: number | null;
  atende_estoque: boolean | null;
  prazo_reposicao_dias: number | null;
};

type SaidaPesquisador = {
  itens: ItemContexto[];
  condicao_pagamento_dias: number | null;
  desconto_maximo_pct: number | null;
  observacoes: string;
};

type SaidaRedator = {
  resposta: string;
  resumo: string;
};

type SaidaRevisor = {
  aprovado: boolean;
  motivos: string[];
};

// Reforco estruturado das mesmas regras que ja estao em
// prompts/vendas/revisor.md (nao e copia do texto do prompt — o system
// prompt e a autoridade; isto so da ao Revisor os pontos como dado).
const REGRAS_REVISOR = [
  "Nao prometer entrega imediata quando o estoque nao cobre a quantidade pedida.",
  "Nao oferecer desconto acima do desconto_maximo_pct do cliente.",
  "Nao citar produto fora do contexto ou marcado como existe = false.",
  "Precos e quantidades da resposta devem bater com o contexto (total = quantidade x preco aplicado).",
  "Condicao de pagamento igual a do contexto.",
  "Sem placeholders, colchetes ou frases inacabadas.",
];

const PALAVRAS_IGNORADAS = new Set([
  "de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "um", "uma",
  "uns", "umas", "para", "com", "em", "no", "na", "se", "ou", "por", "que",
  "tem", "ainda", "sobre", "pra",
]);

function palavrasPrincipais(descricao: string): string[] {
  return descricao
    .toLowerCase()
    .split(/\s+/)
    .map((palavra) => palavra.replace(/[.,;:!?()]/g, ""))
    .filter((palavra) => palavra.length >= 2 && !PALAVRAS_IGNORADAS.has(palavra));
}

// Catalogo: para cada item do Triador, busca em Produtos por semelhanca de
// descricao (ilike com as palavras principais). Codigo determinístico, sem
// modelo (SPEC 4.2 / CLAUDE.md).
async function buscarCandidatosCatalogo(
  supabase: ReturnType<typeof criarClienteServidor>,
  itens: ItemTriagem[]
): Promise<CandidatosPorItem[]> {
  return Promise.all(
    itens.map(async (item) => {
      const palavras = palavrasPrincipais(item.descricao_cliente);
      if (palavras.length === 0) {
        return { descricao_cliente: item.descricao_cliente, candidatos: [] };
      }

      const filtro = palavras.map((p) => `descricao.ilike.%${p}%`).join(",");
      const { data } = await supabase
        .from("Produtos")
        .select(
          "cod_produto, descricao, unidade, preco_unitario, preco_acima_100_un, estoque, prazo_reposicao_dias"
        )
        .or(filtro);

      return { descricao_cliente: item.descricao_cliente, candidatos: (data as Produto[]) ?? [] };
    })
  );
}

// Cliente: a linha da tabela + pedidos anteriores do mesmo cliente nos
// ultimos 30 dias (janela calculada a partir da data do pedido atual).
async function buscarDadosCliente(
  supabase: ReturnType<typeof criarClienteServidor>,
  codCliente: string,
  dataPedido: string,
  codPedidoAtual: string
): Promise<{ cliente: Cliente | null; pedidosAnteriores: PedidoAnterior[] }> {
  const inicioJanela = new Date(dataPedido);
  inicioJanela.setDate(inicioJanela.getDate() - 30);
  const inicioJanelaIso = inicioJanela.toISOString().slice(0, 10);

  const [{ data: clienteRow }, { data: pedidosAnteriores }] = await Promise.all([
    supabase
      .from("Clientes")
      .select("cod_cliente, nome, segmento, prazo_pagamento_dias, desconto_maximo_pct, cliente_desde")
      .eq("cod_cliente", codCliente)
      .maybeSingle(),
    supabase
      .from("pedidos_orcamentos")
      .select("cod_pedido, data, canal, mensagem, status")
      .eq("cod_cliente", codCliente)
      .neq("cod_pedido", codPedidoAtual)
      .gte("data", inicioJanelaIso)
      .lt("data", dataPedido)
      .order("data", { ascending: false }),
  ]);

  return {
    cliente: (clienteRow as Cliente) ?? null,
    pedidosAnteriores: (pedidosAnteriores as PedidoAnterior[]) ?? [],
  };
}

export async function processarPedidoVendas(codPedido: string) {
  const supabase = criarClienteServidor();

  const { data: pedido, error: erroPedido } = await supabase
    .from("pedidos_orcamentos")
    .select("cod_pedido, data, cod_cliente, canal, mensagem")
    .eq("cod_pedido", codPedido)
    .single();

  if (erroPedido || !pedido) {
    throw new Error("Pedido nao encontrado.");
  }

  // 1. Atualiza pedido para processando. Cria a execucao raiz orquestrador.
  await supabase
    .from("pedidos_orcamentos")
    .update({ status: "processando" })
    .eq("cod_pedido", codPedido);

  const { data: raiz, error: erroRaiz } = await supabase
    .from("execucoes_agentes")
    .insert({
      area: "vendas",
      item_tipo: "pedido",
      item_id: codPedido,
      agente: "orquestrador",
      chamado_por: null,
      status: "rodando",
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (erroRaiz || !raiz) {
    throw new Error("Falha ao iniciar orquestrador.");
  }

  const execucaoRaizId = raiz.id as string;
  const contextoExec = {
    area: "vendas" as const,
    item_tipo: "pedido" as const,
    item_id: codPedido,
    chamado_por: execucaoRaizId,
  };

  try {
    // 2. Triador
    const { data: clientePreTriagem } = await supabase
      .from("Clientes")
      .select("cod_cliente, nome, segmento")
      .eq("cod_cliente", pedido.cod_cliente)
      .maybeSingle();

    const { saida: triagem } = await agente<SaidaTriador>(
      "triador",
      {
        mensagem: pedido.mensagem,
        canal: pedido.canal,
        cliente: {
          cod_cliente: pedido.cod_cliente,
          nome: clientePreTriagem?.nome ?? null,
          segmento: clientePreTriagem?.segmento ?? null,
        },
      },
      contextoExec
    );

    if (triagem.tipo !== "orcamento" && triagem.tipo !== "complemento") {
      await supabase.from("aprovacoes").insert({
        area: "vendas",
        item_tipo: "pedido",
        item_id: codPedido,
        titulo: `Não é orçamento: ${triagem.tipo}`,
        proposta: triagem,
        status: "pendente",
      });

      await supabase
        .from("pedidos_orcamentos")
        .update({ status: "aguardando_aprovacao" })
        .eq("cod_pedido", codPedido);

      await supabase
        .from("execucoes_agentes")
        .update({ status: "ok", fim: new Date().toISOString() })
        .eq("id", execucaoRaizId);

      return { encerradoNoTriador: true as const, triagem };
    }

    // 3. Pesquisador — duas consultas ao banco em paralelo, em codigo.
    const [candidatosCatalogo, dadosCliente] = await Promise.all([
      buscarCandidatosCatalogo(supabase, triagem.itens),
      buscarDadosCliente(supabase, pedido.cod_cliente, pedido.data, codPedido),
    ]);

    const { saida: contexto } = await agente<SaidaPesquisador>(
      "pesquisador",
      {
        itens_pedidos: triagem.itens,
        candidatos_catalogo: candidatosCatalogo,
        cliente: dadosCliente.cliente ?? { cod_cliente: pedido.cod_cliente },
        pedidos_anteriores: dadosCliente.pedidosAnteriores,
      },
      contextoExec
    );

    // 4. Redator + 5. Revisor, com no maximo 2 voltas quando reprovar.
    const clienteRedator = {
      nome: dadosCliente.cliente?.nome ?? null,
      segmento: dadosCliente.cliente?.segmento ?? null,
    };

    let entradaRedator: Record<string, unknown> = {
      triagem,
      contexto,
      cliente: clienteRedator,
    };

    let { saida: redacao } = await agente<SaidaRedator>("redator", entradaRedator, contextoExec);
    let { saida: revisao } = await agente<SaidaRevisor>(
      "revisor",
      { resposta: redacao.resposta, contexto, regras: REGRAS_REVISOR },
      contextoExec
    );

    let voltas = 0;
    while (!revisao.aprovado && voltas < 2) {
      voltas++;
      entradaRedator = { ...entradaRedator, ajustes: revisao.motivos };

      ({ saida: redacao } = await agente<SaidaRedator>("redator", entradaRedator, contextoExec));
      ({ saida: revisao } = await agente<SaidaRevisor>(
        "revisor",
        { resposta: redacao.resposta, contexto, regras: REGRAS_REVISOR },
        contextoExec
      ));
    }

    // 6. Fila de aprovacao + fecha a execucao raiz.
    const nomeCliente = dadosCliente.cliente?.nome ?? pedido.cod_cliente;

    await supabase.from("aprovacoes").insert({
      area: "vendas",
      item_tipo: "pedido",
      item_id: codPedido,
      titulo: `${nomeCliente} · ${redacao.resumo}`,
      proposta: { resposta: redacao.resposta, triagem, contexto, revisao },
      status: "pendente",
    });

    await supabase
      .from("pedidos_orcamentos")
      .update({ status: "aguardando_aprovacao" })
      .eq("cod_pedido", codPedido);

    await supabase
      .from("execucoes_agentes")
      .update({ status: "ok", fim: new Date().toISOString() })
      .eq("id", execucaoRaizId);

    return {
      encerradoNoTriador: false as const,
      triagem,
      contexto,
      redacao,
      revisao,
      voltas,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await supabase
      .from("execucoes_agentes")
      .update({ status: "erro", erro: mensagem, fim: new Date().toISOString() })
      .eq("id", execucaoRaizId);

    await supabase
      .from("pedidos_orcamentos")
      .update({ status: "novo" })
      .eq("cod_pedido", codPedido);

    throw erro;
  }
}
