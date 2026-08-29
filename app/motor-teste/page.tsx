"use client";

// PAGINA TEMPORARIA DE TESTE — nao faz parte do SPEC.
// Serve so para validar visualmente Organograma, FilaAprovacao e LinhaDoTempo
// com dados fake antes de /vendas e /financeiro existirem. Remover quando
// essas telas forem construidas de verdade.

import { useState } from "react";
import Organograma from "@/components/Organograma";
import FilaAprovacao from "@/components/FilaAprovacao";
import LinhaDoTempo from "@/components/LinhaDoTempo";

const ITEM_VENDAS = "PED-TESTE-01";
const ITEM_FINANCEIRO = "DIV-TESTE-01";

export default function PaginaMotorTeste() {
  const [itemSelecionado, setItemSelecionado] = useState(ITEM_VENDAS);

  return (
    <div className="flex flex-1 flex-col gap-8 bg-zinc-50 p-8 dark:bg-black">
      <div className="rounded border border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
        Pagina temporaria de teste do Motor — dados fake, remover depois.
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          Organograma · vendas · {ITEM_VENDAS}
        </h2>
        <Organograma area="vendas" itemId={ITEM_VENDAS} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          Organograma · financeiro · {ITEM_FINANCEIRO}
        </h2>
        <Organograma area="financeiro" itemId={ITEM_FINANCEIRO} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          FilaAprovacao · vendas
        </h2>
        <FilaAprovacao area="vendas" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">LinhaDoTempo</h2>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setItemSelecionado(ITEM_VENDAS)}
            className={`rounded px-3 py-1 ${itemSelecionado === ITEM_VENDAS ? "bg-black text-white dark:bg-white dark:text-black" : "border border-black/[.08] text-black dark:border-white/[.145] dark:text-zinc-50"}`}
          >
            {ITEM_VENDAS}
          </button>
          <button
            onClick={() => setItemSelecionado(ITEM_FINANCEIRO)}
            className={`rounded px-3 py-1 ${itemSelecionado === ITEM_FINANCEIRO ? "bg-black text-white dark:bg-white dark:text-black" : "border border-black/[.08] text-black dark:border-white/[.145] dark:text-zinc-50"}`}
          >
            {ITEM_FINANCEIRO}
          </button>
        </div>
        <LinhaDoTempo itemId={itemSelecionado} />
      </section>
    </div>
  );
}
