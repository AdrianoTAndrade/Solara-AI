import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { criarClienteServidor } from "./supabase/servidor";

// Papeis de agente definidos no SPEC. "orquestrador" nao entra aqui: ele nao
// chama a API da Anthropic, so cria/atualiza a linha raiz em execucoes_agentes
// (feito pelo proprio orquestrador em lib/orquestradores/).
export type Papel =
  | "triador"
  | "pesquisador"
  | "redator"
  | "revisor"
  | "investigador"
  | "consolidador";

export type Contexto = {
  area: "vendas" | "financeiro";
  item_tipo: "pedido" | "divergencia";
  item_id: string;
  chamado_por: string;
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELO = "claude-sonnet-4-6";
const MAX_TOKENS = 2000;

// Unica funcao pela qual todo agente passa. Nunca chamar a API da Anthropic
// de outro lugar (SPEC 3.2 / CLAUDE.md).
export async function agente<TSaida = unknown>(
  papel: Papel,
  entrada: unknown,
  contexto: Contexto
): Promise<{ saida: TSaida; execucao_id: string }> {
  const supabase = criarClienteServidor();

  const { data: execucao, error: erroInsercao } = await supabase
    .from("execucoes_agentes")
    .insert({
      area: contexto.area,
      item_tipo: contexto.item_tipo,
      item_id: contexto.item_id,
      agente: papel,
      chamado_por: contexto.chamado_por,
      status: "rodando",
      entrada,
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (erroInsercao || !execucao) {
    throw new Error(
      `Falha ao registrar execucao do agente ${papel}: ${erroInsercao?.message}`
    );
  }

  const execucaoId = execucao.id as string;

  try {
    const promptSistema = await readFile(
      path.join(process.cwd(), "prompts", contexto.area, `${papel}.md`),
      "utf-8"
    );

    const resposta = await anthropic.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: promptSistema,
      messages: [{ role: "user", content: JSON.stringify(entrada) }],
    });

    const textoResposta = resposta.content
      .filter((bloco) => bloco.type === "text")
      .map((bloco) => bloco.text)
      .join("");

    let saida: TSaida;
    try {
      saida = JSON.parse(textoResposta) as TSaida;
    } catch {
      throw new Error(
        `Resposta do agente ${papel} nao e JSON valido: ${textoResposta}`
      );
    }

    await supabase
      .from("execucoes_agentes")
      .update({
        status: "ok",
        saida,
        tokens_entrada: resposta.usage.input_tokens,
        tokens_saida: resposta.usage.output_tokens,
        fim: new Date().toISOString(),
      })
      .eq("id", execucaoId);

    return { saida, execucao_id: execucaoId };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await supabase
      .from("execucoes_agentes")
      .update({
        status: "erro",
        erro: mensagem,
        fim: new Date().toISOString(),
      })
      .eq("id", execucaoId);

    throw erro;
  }
}
