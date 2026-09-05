import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/api-auth";
import { processarConciliacaoFinanceiro } from "@/lib/orquestradores/financeiro";

export const maxDuration = 60;

// Rota fina: so autentica e delega ao orquestrador em lib/orquestradores/.
export async function POST(req: Request) {
  const contexto = await exigirArea(req, "financeiro");
  if (!contexto) {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const corpo = (await req.json()) as { extrato_id?: string };
  if (!corpo.extrato_id) {
    return NextResponse.json({ erro: "Informe extrato_id." }, { status: 400 });
  }

  try {
    const resultado = await processarConciliacaoFinanceiro(corpo.extrato_id);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao conciliar.";
    const status = mensagem === "Extrato nao encontrado." ? 404 : 500;
    return NextResponse.json({ erro: mensagem }, { status });
  }
}
