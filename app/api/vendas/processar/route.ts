import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/api-auth";
import { processarPedidoVendas } from "@/lib/orquestradores/vendas";

export const maxDuration = 60;

// Rota fina: so autentica e delega ao orquestrador em lib/orquestradores/.
// O modelo nunca decide a sequencia de agentes (CLAUDE.md).
export async function POST(req: Request) {
  const contexto = await exigirArea(req, "vendas");
  if (!contexto) {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const corpo = (await req.json()) as { cod_pedido?: string };
  const codPedido = corpo.cod_pedido;
  if (!codPedido) {
    return NextResponse.json({ erro: "Informe cod_pedido." }, { status: 400 });
  }

  try {
    const resultado = await processarPedidoVendas(codPedido);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao processar pedido.";
    const status = mensagem === "Pedido nao encontrado." ? 404 : 500;
    return NextResponse.json({ erro: mensagem }, { status });
  }
}
