import type { LancamentoLimpo, TituloLimpo } from "./limpar";

// Casamento de lancamentos com titulos — codigo determinístico, sem modelo
// (SPEC 5.3 / CLAUDE.md). So credito casa; debito e sempre ignorado.

export type TipoInicialDivergencia =
  | "valor_diferente_mesma_nf"
  | "sem_titulo_correspondente"
  | "possivel_soma"
  | "duplicado"
  | "vencido_sem_pagamento";

export type LancamentoCasado = LancamentoLimpo & {
  situacao: "casado" | "divergente" | "ignorado";
  cod_titulo_casado: string | null;
};

export type DivergenciaCasamento = {
  tipo_inicial: TipoInicialDivergencia;
  lancamento_index: number | null; // indice em lancamentos[]; null para vencido_sem_pagamento
  cod_titulo: string | null;
  valor_lancamento: number | null;
  valor_titulo: number | null;
};

export type ResultadoCasamento = {
  lancamentos: LancamentoCasado[];
  divergencias: DivergenciaCasamento[];
  resumo: {
    qtd_casados: number;
    valor_casado: number;
    qtd_divergencias: number;
    valor_divergente: number;
  };
};

const TOLERANCIA_VALOR = 0.01;
const JANELA_VENCIMENTO_DIAS = 5;

function valoresIguais(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA_VALOR;
}

function diferencaEmDias(dataA: string, dataB: string): number {
  const a = new Date(dataA).getTime();
  const b = new Date(dataB).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function extrairNotaFiscal(descricao: string): string | null {
  const m = descricao.match(/NF-?(\d+)/i);
  return m ? `NF-${m[1]}` : null;
}

// Par de titulos do MESMO cliente cuja soma bate com o valor do lancamento
// (SPEC 5.3, tipo "possivel_soma").
function encontrarParComSoma(
  titulosDisponiveis: TituloLimpo[],
  valorAlvo: number
): { a: TituloLimpo; b: TituloLimpo } | null {
  const porCliente = new Map<string, TituloLimpo[]>();
  for (const titulo of titulosDisponiveis) {
    const lista = porCliente.get(titulo.cod_cliente) ?? [];
    lista.push(titulo);
    porCliente.set(titulo.cod_cliente, lista);
  }

  for (const lista of porCliente.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        if (valoresIguais(lista[i].valor + lista[j].valor, valorAlvo)) {
          return { a: lista[i], b: lista[j] };
        }
      }
    }
  }
  return null;
}

export function casar(
  lancamentosLimpos: LancamentoLimpo[],
  titulosAbertos: TituloLimpo[]
): ResultadoCasamento {
  const jaCasados = new Set<string>();
  const lancamentos: LancamentoCasado[] = [];
  const divergencias: DivergenciaCasamento[] = [];

  lancamentosLimpos.forEach((lancamento, indice) => {
    if (lancamento.tipo === "debito") {
      lancamentos.push({ ...lancamento, situacao: "ignorado", cod_titulo_casado: null });
      return;
    }

    const nf = extrairNotaFiscal(lancamento.descricao);

    // 1. Descricao traz NF-<n> e existe titulo com essa nota e mesmo valor.
    if (nf) {
      const titulo = titulosAbertos.find(
        (t) => t.nota_fiscal.toUpperCase() === nf.toUpperCase()
      );
      if (titulo) {
        if (jaCasados.has(titulo.cod_titulo)) {
          lancamentos.push({ ...lancamento, situacao: "divergente", cod_titulo_casado: null });
          divergencias.push({
            tipo_inicial: "duplicado",
            lancamento_index: indice,
            cod_titulo: titulo.cod_titulo,
            valor_lancamento: lancamento.valor,
            valor_titulo: titulo.valor,
          });
          return;
        }

        if (valoresIguais(lancamento.valor, titulo.valor)) {
          jaCasados.add(titulo.cod_titulo);
          lancamentos.push({ ...lancamento, situacao: "casado", cod_titulo_casado: titulo.cod_titulo });
          return;
        }

        lancamentos.push({ ...lancamento, situacao: "divergente", cod_titulo_casado: null });
        divergencias.push({
          tipo_inicial: "valor_diferente_mesma_nf",
          lancamento_index: indice,
          cod_titulo: titulo.cod_titulo,
          valor_lancamento: lancamento.valor,
          valor_titulo: titulo.valor,
        });
        return;
      }
    }

    // 2. Exatamente um titulo em aberto com mesmo valor e vencimento a ate 5
    // dias da data do lancamento.
    const candidatosPorValor = titulosAbertos.filter(
      (t) =>
        !jaCasados.has(t.cod_titulo) &&
        valoresIguais(lancamento.valor, t.valor) &&
        diferencaEmDias(t.vencimento, lancamento.data) <= JANELA_VENCIMENTO_DIAS
    );

    if (candidatosPorValor.length === 1) {
      const titulo = candidatosPorValor[0];
      jaCasados.add(titulo.cod_titulo);
      lancamentos.push({ ...lancamento, situacao: "casado", cod_titulo_casado: titulo.cod_titulo });
      return;
    }

    // 3. Divergente — decide o tipo_inicial.
    lancamentos.push({ ...lancamento, situacao: "divergente", cod_titulo_casado: null });

    const disponiveis = titulosAbertos.filter((t) => !jaCasados.has(t.cod_titulo));
    const par = encontrarParComSoma(disponiveis, lancamento.valor);
    if (par) {
      divergencias.push({
        tipo_inicial: "possivel_soma",
        lancamento_index: indice,
        cod_titulo: null,
        valor_lancamento: lancamento.valor,
        valor_titulo: par.a.valor + par.b.valor,
      });
      return;
    }

    divergencias.push({
      tipo_inicial: "sem_titulo_correspondente",
      lancamento_index: indice,
      cod_titulo: null,
      valor_lancamento: lancamento.valor,
      valor_titulo: null,
    });
  });

  // Todo titulo em aberto com vencimento anterior a data final do extrato e
  // sem lancamento casado vira divergencia vencido_sem_pagamento.
  const dataFinalExtrato = lancamentosLimpos.reduce(
    (maxData, l) => (l.data > maxData ? l.data : maxData),
    ""
  );

  for (const titulo of titulosAbertos) {
    if (jaCasados.has(titulo.cod_titulo)) continue;
    if (dataFinalExtrato && titulo.vencimento < dataFinalExtrato) {
      divergencias.push({
        tipo_inicial: "vencido_sem_pagamento",
        lancamento_index: null,
        cod_titulo: titulo.cod_titulo,
        valor_lancamento: null,
        valor_titulo: titulo.valor,
      });
    }
  }

  const casados = lancamentos.filter((l) => l.situacao === "casado");
  const resumo = {
    qtd_casados: casados.length,
    valor_casado: casados.reduce((soma, l) => soma + l.valor, 0),
    qtd_divergencias: divergencias.length,
    valor_divergente: divergencias.reduce(
      (soma, d) => soma + (d.valor_lancamento ?? d.valor_titulo ?? 0),
      0
    ),
  };

  return { lancamentos, divergencias, resumo };
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

// Tenta achar o cliente pelo nome dentro da descricao do lancamento (PIX
// RECEBIDO <NOME DO CLIENTE> NF-...). Usado pelo orquestrador para montar os
// titulos_candidatos do Investigador (SPEC 5.4).
export function identificarClientePelaDescricao(
  descricao: string,
  clientes: { cod_cliente: string; nome: string }[]
): string | null {
  const descNormalizada = normalizar(descricao);
  const encontrado = clientes.find((c) => descNormalizada.includes(normalizar(c.nome)));
  return encontrado?.cod_cliente ?? null;
}
