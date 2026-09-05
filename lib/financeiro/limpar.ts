// Limpeza de arquivos do Financeiro — codigo determinístico, sem modelo
// (SPEC 5.3 / CLAUDE.md).

export type LancamentoLimpo = {
  data: string; // ISO yyyy-mm-dd
  descricao: string;
  valor: number; // sinal preservado: credito positivo, debito negativo
  tipo: "credito" | "debito";
};

export type TituloLimpo = {
  cod_titulo: string;
  cod_cliente: string;
  nota_fiscal: string;
  valor: number;
  emissao: string;
  vencimento: string;
  status: string;
};

export type ResultadoLimpezaExtrato = {
  linhasOriginais: string[]; // texto do arquivo como veio, uma entrada por linha
  lancamentos: LancamentoLimpo[];
};

// Le o arquivo tentando UTF-8; se falhar, cai para latin-1 (SPEC 5.3).
function decodificar(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("latin1").decode(buffer);
  }
}

function dividirLinhas(texto: string): string[] {
  return texto.split(/\r\n|\r|\n/);
}

// "1.250,00" -> 1250.00 ; "-45,90" -> -45.90
function paraNumero(valorTexto: string): number {
  const limpo = valorTexto.trim().replace(/\./g, "").replace(",", ".");
  return Number(limpo);
}

// "20/07/2026" -> "2026-07-20"
function paraIso(dataTexto: string): string {
  const [dia, mes, ano] = dataTexto.trim().split("/");
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function ehLinhaDeSaldo(texto: string): boolean {
  return /saldo/i.test(texto);
}

export function limparExtrato(buffer: Buffer): ResultadoLimpezaExtrato {
  const texto = decodificar(buffer);
  const linhas = dividirLinhas(texto);
  const linhasOriginais = linhas.filter((l) => l.trim().length > 0);

  const primeiraLinha = linhasOriginais[0]?.trim() ?? "";

  // Arquivo ja limpo: cabecalho cod_lancamento,data,descricao,valor,tipo.
  if (/^cod_lancamento\s*,\s*data/i.test(primeiraLinha)) {
    const lancamentos: LancamentoLimpo[] = [];
    for (const linha of linhasOriginais.slice(1)) {
      const colunas = linha.split(",");
      if (colunas.length < 5) continue;
      const [, data, descricao, valorTexto, tipoTexto] = colunas;
      const valor = Number(valorTexto);
      const tipo: "credito" | "debito" = tipoTexto.trim().toLowerCase() === "debito" ? "debito" : "credito";
      lancamentos.push({ data: data.trim(), descricao: descricao.trim(), valor, tipo });
    }
    return { linhasOriginais, lancamentos };
  }

  // Arquivo bruto: pula ate a linha que comeca com "Data", detecta separador,
  // ignora linhas de SALDO, converte data e valor, descarta a coluna de saldo.
  const indiceCabecalho = linhasOriginais.findIndex((l) => /^data\b/i.test(l.trim()));
  if (indiceCabecalho === -1) {
    throw new Error("Nao foi possivel encontrar o cabecalho (linha que comeca com \"Data\") no extrato.");
  }

  const linhaCabecalho = linhasOriginais[indiceCabecalho];
  const separador = linhaCabecalho.includes(";") ? ";" : ",";

  const lancamentos: LancamentoLimpo[] = [];
  for (const linha of linhasOriginais.slice(indiceCabecalho + 1)) {
    if (ehLinhaDeSaldo(linha)) continue;

    const colunas = linha.split(separador);
    if (colunas.length < 3) continue;
    const [dataTexto, descricao, valorTexto] = colunas;
    if (!dataTexto?.trim() || !valorTexto?.trim()) continue;

    const valor = paraNumero(valorTexto);
    if (Number.isNaN(valor)) continue;

    lancamentos.push({
      data: paraIso(dataTexto),
      descricao: descricao.trim(),
      valor,
      tipo: valor < 0 ? "debito" : "credito",
    });
  }

  return { linhasOriginais, lancamentos };
}

// Titulos: so existe o formato limpo (cod_titulo,cod_cliente,nota_fiscal,
// valor,emissao,vencimento,status) — nao ha versao "bruta" definida no SPEC.
export function limparTitulos(buffer: Buffer): TituloLimpo[] {
  const texto = decodificar(buffer);
  const linhas = dividirLinhas(texto).filter((l) => l.trim().length > 0);

  const titulos: TituloLimpo[] = [];
  for (const linha of linhas.slice(1)) {
    const colunas = linha.split(",");
    if (colunas.length < 7) continue;
    const [cod_titulo, cod_cliente, nota_fiscal, valorTexto, emissao, vencimento, status] = colunas;
    titulos.push({
      cod_titulo: cod_titulo.trim(),
      cod_cliente: cod_cliente.trim(),
      nota_fiscal: nota_fiscal.trim(),
      valor: Number(valorTexto),
      emissao: emissao.trim(),
      vencimento: vencimento.trim(),
      status: status.trim(),
    });
  }
  return titulos;
}
