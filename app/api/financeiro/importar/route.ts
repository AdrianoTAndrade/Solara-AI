import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { exigirArea } from "@/lib/api-auth";
import { limparExtrato, limparTitulos } from "@/lib/financeiro/limpar";
import { casar } from "@/lib/financeiro/casar";

export const maxDuration = 60;

// Upload + limpeza + casamento (tudo codigo, sem modelo — SPEC 5.3). Cria
// extratos_importados, lancamentos e divergencias("nova"). A conciliacao com
// os agentes so acontece depois, no botao Conciliar (POST /api/financeiro/conciliar).
export async function POST(req: Request) {
  const contexto = await exigirArea(req, "financeiro");
  if (!contexto) {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const formData = await req.formData();
  const arquivoExtrato = formData.get("extrato");
  const arquivoTitulos = formData.get("titulos");

  if (!(arquivoExtrato instanceof File)) {
    return NextResponse.json({ erro: "Envie o arquivo do extrato." }, { status: 400 });
  }

  const supabase = criarClienteServidor();

  let resultadoLimpeza;
  try {
    resultadoLimpeza = limparExtrato(Buffer.from(await arquivoExtrato.arrayBuffer()));
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao ler o extrato.";
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }

  let titulosAbertos;
  if (arquivoTitulos instanceof File && arquivoTitulos.size > 0) {
    titulosAbertos = limparTitulos(Buffer.from(await arquivoTitulos.arrayBuffer())).filter(
      (t) => t.status === "aberto"
    );
  } else {
    const { data } = await supabase
      .from("titulos_receber")
      .select("cod_titulo, cod_cliente, nota_fiscal, valor, emissao, vencimento, status")
      .eq("status", "aberto");
    titulosAbertos = data ?? [];
  }

  const resultadoCasamento = casar(resultadoLimpeza.lancamentos, titulosAbertos);
  const totalCreditos = resultadoLimpeza.lancamentos.filter((l) => l.tipo === "credito").length;

  const { data: extrato, error: erroExtrato } = await supabase
    .from("extratos_importados")
    .insert({
      nome_arquivo: arquivoExtrato.name,
      importado_por: contexto.usuario.id,
      total_linhas: resultadoLimpeza.lancamentos.length,
      total_creditos: totalCreditos,
    })
    .select("id, nome_arquivo, importado_em")
    .single();

  if (erroExtrato || !extrato) {
    return NextResponse.json({ erro: "Falha ao salvar o extrato." }, { status: 500 });
  }

  const { data: lancamentosInseridos, error: erroLancamentos } = await supabase
    .from("lancamentos")
    .insert(
      resultadoCasamento.lancamentos.map((l) => ({
        extrato_id: extrato.id,
        data: l.data,
        descricao: l.descricao,
        valor: l.valor,
        tipo: l.tipo,
        cod_titulo_casado: l.cod_titulo_casado,
        situacao: l.situacao,
      }))
    )
    .select("id");

  if (erroLancamentos || !lancamentosInseridos) {
    return NextResponse.json({ erro: "Falha ao salvar os lancamentos." }, { status: 500 });
  }

  const divergenciasParaInserir = resultadoCasamento.divergencias.map((d) => ({
    extrato_id: extrato.id,
    tipo_inicial: d.tipo_inicial,
    lancamento_id: d.lancamento_index !== null ? lancamentosInseridos[d.lancamento_index].id : null,
    cod_titulo: d.cod_titulo,
    valor_lancamento: d.valor_lancamento,
    valor_titulo: d.valor_titulo,
    status: "nova",
  }));

  if (divergenciasParaInserir.length > 0) {
    const { error: erroDivergencias } = await supabase.from("divergencias").insert(divergenciasParaInserir);
    if (erroDivergencias) {
      return NextResponse.json({ erro: "Falha ao salvar as divergencias." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    extrato,
    antes: resultadoLimpeza.linhasOriginais.slice(0, 6),
    depois: resultadoLimpeza.lancamentos
      .slice(0, 6)
      .map((l) => `${l.data},${l.descricao},${l.valor},${l.tipo}`),
    resumo: resultadoCasamento.resumo,
  });
}
