"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/cliente";
import { chamarApi } from "@/lib/chamar-api";

type Perfil = {
  id: string;
  email: string;
  nome: string;
  papel: "admin" | "operador";
  areas: string[];
  criado_em?: string;
};

const AREAS_DISPONIVEIS = ["vendas", "financeiro"];

export default function PaginaAdmin() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [autorizado, setAutorizado] = useState(false);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState<"admin" | "operador">("operador");
  const [areas, setAreas] = useState<string[]>([]);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function carregarPerfis() {
    const resp = await chamarApi("/api/admin/perfis");
    if (!resp.ok) {
      setErroLista("Falha ao carregar perfis.");
      return;
    }
    const corpo = await resp.json();
    setPerfis(corpo.perfis ?? []);
  }

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
      if (corpo.perfil?.papel !== "admin") {
        router.replace("/");
        return;
      }

      if (ativo) {
        setAutorizado(true);
        await carregarPerfis();
        setCarregando(false);
      }
    }

    verificar();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function alternarArea(area: string) {
    setAreas((atual) =>
      atual.includes(area) ? atual.filter((a) => a !== area) : [...atual, area]
    );
  }

  async function criarUsuario(evento: React.FormEvent) {
    evento.preventDefault();
    setErroForm(null);
    setEnviando(true);

    const resp = await chamarApi("/api/admin/usuarios", {
      method: "POST",
      body: JSON.stringify({ email, senha, nome, papel, areas }),
    });

    const corpo = await resp.json();
    setEnviando(false);

    if (!resp.ok) {
      setErroForm(corpo.erro ?? "Falha ao criar usuario.");
      return;
    }

    setEmail("");
    setSenha("");
    setNome("");
    setPapel("operador");
    setAreas([]);
    await carregarPerfis();
  }

  if (carregando || !autorizado) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 bg-zinc-50 p-8 dark:bg-black">
      <div>
        <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Administração</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Usuários do Solara OS</p>
      </div>

      <section className="rounded-lg border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/[.08] text-zinc-500 dark:border-white/[.145] dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Papel</th>
              <th className="px-4 py-2 font-medium">Áreas</th>
            </tr>
          </thead>
          <tbody>
            {perfis.map((p) => (
              <tr key={p.id} className="border-b border-black/[.05] last:border-0 dark:border-white/[.08]">
                <td className="px-4 py-2 text-black dark:text-zinc-50">{p.email}</td>
                <td className="px-4 py-2 text-black dark:text-zinc-50">{p.nome}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{p.papel}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                  {p.areas?.join(", ") || "—"}
                </td>
              </tr>
            ))}
            {perfis.length === 0 && !erroLista && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-zinc-400">
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {erroLista && <p className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{erroLista}</p>}
      </section>

      <section className="max-w-md rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
        <h2 className="mb-4 text-base font-semibold text-black dark:text-zinc-50">
          Criar usuário
        </h2>
        <form onSubmit={criarUsuario} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Senha inicial
            <input
              type="text"
              required
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Nome
            <input
              type="text"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Papel
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value as "admin" | "operador")}
              className="rounded border border-black/[.08] bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.145] dark:text-zinc-50"
            >
              <option value="operador">operador</option>
              <option value="admin">admin</option>
            </select>
          </label>

          <fieldset className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <legend className="mb-1">Áreas</legend>
            {AREAS_DISPONIVEIS.map((area) => (
              <label key={area} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={areas.includes(area)}
                  onChange={() => alternarArea(area)}
                />
                {area}
              </label>
            ))}
          </fieldset>

          {erroForm && <p className="text-sm text-red-600 dark:text-red-400">{erroForm}</p>}

          <button
            type="submit"
            disabled={enviando}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {enviando ? "Criando..." : "Criar usuário"}
          </button>
        </form>
      </section>
    </div>
  );
}
