import { criarClienteServidor } from "@/lib/supabase/servidor";
import { agente } from "@/lib/agente";
import { identificarClientePelaDescricao } from "@/lib/financeiro/casar";

// Orquestrador de Financeiro (SPEC 5.4). Codigo comum: decide a sequencia de
// agentes, o modelo nunca escolhe quem chamar (CLAUDE.md).
//
// Todas as execucoes desta conciliacao (orquestrador, investigadores,
// consolidador, revisor) usam item_id = extrato_id, para o Organograma e a
// LinhaDoTempo (reaproveitados sem alteracao) mostrarem tudo junto.

type Hipotese =
  | "pagamento_parcial"
  | "dois_titulos_um_pagamento"
  | "duplicidade"
  | "diferenca_centavos"
  | "atraso_com_juros"
  | "vencido_sem_pagamento"
  | "deposito_nao_identificado"
  | "nao_e_titulo"
  | "outro";

type SaidaInvestigador = {
  hipotese: Hipotese;
  explicacao: string;
  confianca: number;
  acao_sugerida: string;
  cod_titulos_envolvidos: string[];
  valor_a_baixar: number | null;
  valor_pendente: number | null;
};

type SaidaConsolidador = {
  relatorio_markdown: string;
  acoes: string[];
};

type SaidaRevisorFinanceiro = {
  aprovado: boolean;
  motivos: string[];
};

type TituloAberto = {
  cod_titulo: string;
  cod_cliente: string;
  nota_fiscal: string;
  valor: number;
  emissao: string;
  vencimento: string;
  status: string;
};

type Divergencia = {
  id: string;
  extrato_id: string;
  tipo_inicial: string;
  lancamento_id: string | null;
  cod_titulo: string | null;
  valor_lancamento: number | null;
  valor_titulo: number | null;
  status: string;
  hipotese: unknown;
};

type Lancamento = {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: "credito" | "debito";
  situacao: "casado" | "divergente" | "ignorado";
  cod_titulo_casado: string | null;
};

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

function diferencaEmDias(dataA: string, dataB: string): number {
  return Math.abs(new Date(dataA).getTime() - new Date(dataB).getTime()) / (1000 * 60 * 60 * 24);
}

// Candidatos do Investigador (SPEC 5.4): titulos do mesmo cliente, se
// identificavel pela descricao; senao, titulos de valor proximo (+-10%) com
// vencimento a ate 30 dias da data de referencia.
function candidatosParaDivergencia(
  divergencia: Divergencia,
  lancamento: Lancamento | null,
  titulosAbertos: TituloAberto[],
  clientes: { cod_cliente: string; nome: string }[]
): TituloAberto[] {
  const codClienteDoTitulo = divergencia.cod_titulo
    ? titulosAbertos.find((t) => t.cod_titulo === divergencia.cod_titulo)?.cod_cliente
    : null;
  const codClienteIdentificado =
    codClienteDoTitulo ?? (lancamento ? identificarClientePelaDescricao(lancamento.descricao, clientes) : null);

  if (codClienteIdentificado) {
    return titulosAbertos.filter((t) => t.cod_cliente === codClienteIdentificado);
  }

  const valorReferencia = divergencia.valor_lancamento ?? divergencia.valor_titulo;
  const dataReferencia =
    lancamento?.data ??
    (divergencia.cod_titulo ? titulosAbertos.find((t) => t.cod_titulo === divergencia.cod_titulo)?.vencimento : null);

  if (valorReferencia == null || !dataReferencia) return [];

  return titulosAbertos.filter(
    (t) =>
      Math.abs(t.valor - valorReferencia) <= valorReferencia * 0.1 &&
      diferencaEmDias(t.vencimento, dataReferencia) <= 30
  );
}

export async function processarConciliacaoFinanceiro(extratoId: string) {
  const supabase = criarClienteServidor();

  const { data: extrato, error: erroExtrato } = await supabase
    .from("extratos_importados")
    .select("id, nome_arquivo")
    .eq("id", extratoId)
    .single();

  if (erroExtrato || !extrato) {
    throw new Error("Extrato nao encontrado.");
  }

  const [{ data: divergenciasExtrato }, { data: titulosAbertos }, { data: clientes }, { data: lancamentos }] =
    await Promise.all([
      supabase.from("divergencias").select("*").eq("extrato_id", extratoId),
      supabase
        .from("titulos_receber")
        .select("cod_titulo, cod_cliente, nota_fiscal, valor, emissao, vencimento, status")
        .eq("status", "aberto"),
      supabase.from("Clientes").select("cod_cliente, nome"),
      supabase.from("lancamentos").select("*").eq("extrato_id", extratoId),
    ]);

  const divergenciasNovas = (divergenciasExtrato as Divergencia[] | null)?.filter((d) => d.status === "nova") ?? [];
  const listaLancamentos = (lancamentos as Lancamento[] | null) ?? [];
  const listaTitulosAbertos = (titulosAbertos as TituloAberto[] | null) ?? [];
  const listaClientes = clientes ?? [];

  const raiz = await criarExecucaoRaiz(supabase, extratoId);
  const contextoExec = {
    area: "financeiro" as const,
    item_tipo: "divergencia" as const,
    item_id: extratoId,
    chamado_por: raiz.id,
  };

  try {
    // 1. Divergencias vao para investigando.
    if (divergenciasNovas.length > 0) {
      await supabase
        .from("divergencias")
        .update({ status: "investigando" })
        .in(
          "id",
          divergenciasNovas.map((d) => d.id)
        );
    }

    // 2. Investigador, um por divergencia, todos em paralelo.
    const investigacoes = await Promise.all(
      divergenciasNovas.map(async (divergencia) => {
        const lancamento = divergencia.lancamento_id
          ? listaLancamentos.find((l) => l.id === divergencia.lancamento_id) ?? null
          : null;

        const candidatos = candidatosParaDivergencia(divergencia, lancamento, listaTitulosAbertos, listaClientes);
        const candidatosComNomeCliente = candidatos.map((t) => ({
          ...t,
          nome_cliente: listaClientes.find((c) => c.cod_cliente === t.cod_cliente)?.nome ?? t.cod_cliente,
        }));

        const { saida } = await agente<SaidaInvestigador>(
          "investigador",
          {
            divergencia: {
              tipo_inicial: divergencia.tipo_inicial,
              valor_lancamento: divergencia.valor_lancamento,
              valor_titulo: divergencia.valor_titulo,
            },
            lancamento: lancamento
              ? { data: lancamento.data, descricao: lancamento.descricao, valor: lancamento.valor }
              : null,
            titulos_candidatos: candidatosComNomeCliente,
          },
          contextoExec
        );

        return { divergencia, hipotese: saida };
      })
    );

    // 3. Consolidador.
    const casados = listaLancamentos.filter((l) => l.situacao === "casado");
    const resumoCasamento = {
      qtd_casados: casados.length,
      valor_casado: casados.reduce((soma, l) => soma + l.valor, 0),
      qtd_divergencias: divergenciasNovas.length,
      valor_divergente: divergenciasNovas.reduce(
        (soma, d) => soma + (d.valor_lancamento ?? d.valor_titulo ?? 0),
        0
      ),
      periodo: periodoDoExtrato(listaLancamentos),
    };

    let { saida: consolidado } = await agente<SaidaConsolidador>(
      "consolidador",
      { resumo_casamento: resumoCasamento, hipoteses: investigacoes.map((i) => i.hipotese) },
      contextoExec
    );

    // 4. Revisor — se reprovar, refaz so o Consolidador, uma vez.
    let { saida: revisao } = await agente<SaidaRevisorFinanceiro>(
      "revisor",
      {
        hipoteses: investigacoes.map((i) => i.hipotese),
        titulos_abertos: listaTitulosAbertos,
        relatorio: { relatorio_markdown: consolidado.relatorio_markdown, acoes: consolidado.acoes },
      },
      contextoExec
    );

    if (!revisao.aprovado) {
      ({ saida: consolidado } = await agente<SaidaConsolidador>(
        "consolidador",
        {
          resumo_casamento: resumoCasamento,
          hipoteses: investigacoes.map((i) => i.hipotese),
          ajustes: revisao.motivos,
        },
        contextoExec
      ));

      ({ saida: revisao } = await agente<SaidaRevisorFinanceiro>(
        "revisor",
        {
          hipoteses: investigacoes.map((i) => i.hipotese),
          titulos_abertos: listaTitulosAbertos,
          relatorio: { relatorio_markdown: consolidado.relatorio_markdown, acoes: consolidado.acoes },
        },
        contextoExec
      ));
    }

    // 5. Cada hipotese vira um item em aprovacoes. Divergencias -> aguardando_aprovacao.
    for (const { divergencia, hipotese } of investigacoes) {
      const nomeCliente =
        hipotese.cod_titulos_envolvidos
          .map((cod) => listaTitulosAbertos.find((t) => t.cod_titulo === cod))
          .find((t) => t)?.cod_cliente ?? null;
      const clienteOuDescricao =
        (nomeCliente && listaClientes.find((c) => c.cod_cliente === nomeCliente)?.nome) ??
        (divergencia.lancamento_id
          ? listaLancamentos.find((l) => l.id === divergencia.lancamento_id)?.descricao
          : divergencia.cod_titulo) ??
        "sem identificação";
      // Prefere o primeiro valor nao-zero: "0" em valor_a_baixar (ex.: titulo
      // vencido, nada baixado ainda) nao e o numero que importa mostrar no
      // titulo da fila — o que importa e o valor em jogo.
      const valorTitulo =
        hipotese.valor_a_baixar ||
        hipotese.valor_pendente ||
        divergencia.valor_lancamento ||
        divergencia.valor_titulo ||
        0;

      await supabase.from("aprovacoes").insert({
        area: "financeiro",
        item_tipo: "divergencia",
        item_id: divergencia.id,
        titulo: `${hipotese.hipotese} · ${clienteOuDescricao} · R$ ${formatarReal(valorTitulo)}`,
        proposta: { divergencia, hipotese, relatorio: consolidado, revisao },
        status: "pendente",
      });

      await supabase.from("divergencias").update({ status: "aguardando_aprovacao", hipotese }).eq("id", divergencia.id);
    }

    await supabase
      .from("execucoes_agentes")
      .update({ status: "ok", fim: new Date().toISOString() })
      .eq("id", raiz.id);

    return {
      qtdDivergenciasProcessadas: divergenciasNovas.length,
      relatorio: consolidado,
      revisao,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await supabase
      .from("execucoes_agentes")
      .update({ status: "erro", erro: mensagem, fim: new Date().toISOString() })
      .eq("id", raiz.id);

    throw erro;
  }
}

async function criarExecucaoRaiz(supabase: ReturnType<typeof criarClienteServidor>, extratoId: string) {
  const { data: raiz, error } = await supabase
    .from("execucoes_agentes")
    .insert({
      area: "financeiro",
      item_tipo: "divergencia",
      item_id: extratoId,
      agente: "orquestrador",
      chamado_por: null,
      status: "rodando",
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !raiz) {
    throw new Error("Falha ao iniciar orquestrador.");
  }
  return raiz;
}

function periodoDoExtrato(lancamentos: Lancamento[]): string {
  if (lancamentos.length === 0) return "";
  const datas = lancamentos.map((l) => l.data).sort();
  return `${datas[0]} a ${datas[datas.length - 1]}`;
}
