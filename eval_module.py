"""
eval_module.py
================
Loop de avaliação: registra toda interação do agente (pergunta, tools
usadas, resposta, provedor, latência) e permite marcar se foi boa ou
não. Isso NÃO é fine-tuning — é o processo sistemático que te diz ONDE
o agente erra, pra você poder agir (ajustar prompt, tool, ou dado de
RAG) em vez de confiar em impressão solta.

Fecha o loop com o memory_module: toda correção registrada aqui também
vira um fato de memória categoria "correcao", pro agente não repetir
o mesmo erro em conversas futuras.

Usa SQLite (nativo do Python, sem dependência extra).

Uso:
    avaliador = Avaliador()
    id_interacao = avaliador.registrar_interacao(
        pergunta="...", resposta="...", tools_usadas=["rodar_semgrep"],
        provedor="claude", latencia_s=2.3,
    )
    avaliador.registrar_feedback(id_interacao, aprovado=False,
                                  correcao="Deveria ter sugerido X em vez de Y")
"""

import sqlite3
import json
import time
import uuid
from dataclasses import dataclass
from collections import Counter


# ---------------------------------------------------------------------------
# 1. ARMAZENAMENTO
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS interacoes (
    id TEXT PRIMARY KEY,
    pergunta TEXT,
    resposta TEXT,
    tools_usadas TEXT,   -- JSON list
    provedor TEXT,
    latencia_s REAL,
    criado_em REAL,
    aprovado INTEGER,    -- NULL = ainda sem feedback, 0 = reprovado, 1 = aprovado
    correcao TEXT
);
"""


@dataclass
class Interacao:
    id: str
    pergunta: str
    resposta: str
    tools_usadas: list
    provedor: str
    latencia_s: float
    aprovado: bool | None
    correcao: str | None


class Avaliador:
    def __init__(self, caminho_db: str = "./avaliacao_agente.db"):
        self.conn = sqlite3.connect(caminho_db)
        self.conn.execute(SCHEMA_SQL)
        self.conn.commit()

    def registrar_interacao(self, pergunta: str, resposta: str, tools_usadas: list[str],
                             provedor: str, latencia_s: float) -> str:
        id_interacao = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO interacoes (id, pergunta, resposta, tools_usadas, provedor, "
            "latencia_s, criado_em, aprovado, correcao) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
            (id_interacao, pergunta, resposta, json.dumps(tools_usadas), provedor, latencia_s, time.time()),
        )
        self.conn.commit()
        return id_interacao

    def registrar_feedback(self, id_interacao: str, aprovado: bool, correcao: str | None = None):
        self.conn.execute(
            "UPDATE interacoes SET aprovado = ?, correcao = ? WHERE id = ?",
            (1 if aprovado else 0, correcao, id_interacao),
        )
        self.conn.commit()

        # Fecha o loop: toda correção também vira memória de longo prazo,
        # pra não repetir o mesmo erro em conversas futuras.
        if not aprovado and correcao:
            try:
                # Tenta usar a memória do Python se houver, ou apenas salvar em JSON/SQLite
                from memory_module import tool_salvar_memoria
                tool_salvar_memoria(
                    texto=f"Correção registrada: {correcao}",
                    categoria="correcao",
                )
            except ImportError:
                # Alternativa para manter a consistência com o MemoryBase em TS/JSON se desejado,
                # ou apenas passar silenciosamente conforme especificado.
                pass  # memory_module ainda não plugado — segue sem quebrar

    def relatorio_qualidade(self) -> dict:
        linhas = self.conn.execute(
            "SELECT tools_usadas, provedor, aprovado FROM interacoes WHERE aprovado IS NOT NULL"
        ).fetchall()

        total = len(linhas)
        if total == 0:
            return {"total_avaliadas": 0}

        aprovadas = sum(1 for _, _, a in linhas if a == 1)
        falhas_por_provedor = Counter(p for _, p, a in linhas if a == 0)
        falhas_por_tool = Counter()
        for tools_json, _, a in linhas:
            if a == 0:
                try:
                    tools = json.loads(tools_json)
                    for t in tools:
                        falhas_por_tool[t] += 1
                except Exception:
                    pass

        return {
            "total_avaliadas": total,
            "taxa_aprovacao": round(aprovadas / total, 3),
            "falhas_por_provedor": dict(falhas_por_provedor),
            "falhas_por_tool": dict(falhas_por_tool),
        }

    def exportar_dataset_correcoes(self, caminho_saida: str = "./dataset_correcoes.jsonl"):
        """Exporta pares pergunta/resposta_corrigida em JSONL — formato
        pronto pra virar dataset de fine-tuning no item 5 da lista."""
        linhas = self.conn.execute(
            "SELECT pergunta, resposta, correcao FROM interacoes WHERE aprovado = 0 AND correcao IS NOT NULL"
        ).fetchall()

        with open(caminho_saida, "w", encoding="utf-8") as f:
            for pergunta, resposta_errada, correcao in linhas:
                f.write(json.dumps({
                    "pergunta": pergunta,
                    "resposta_errada": resposta_errada,
                    "resposta_corrigida": correcao,
                }, ensure_ascii=False) + "\n")

        return len(linhas)


# --- DEMO ---
if __name__ == "__main__":
    av = Avaliador()

    id1 = av.registrar_interacao(
        pergunta="Essa CVE-2021-44228 é crítica?",
        resposta="Sim, CVSS 9.8, mas não vi exploit conhecido.",
        tools_usadas=["consultar_cve"],
        provedor="claude",
        latencia_s=1.8,
    )
    av.registrar_feedback(id1, aprovado=False,
                           correcao="A resposta errou: essa CVE TEM exploit conhecido e ativo, é a Log4Shell.")

    id2 = av.registrar_interacao(
        pergunta="Roda um scan nesse código",
        resposta="Encontrei command injection na linha 3.",
        tools_usadas=["rodar_semgrep"],
        provedor="openai",
        latencia_s=3.1,
    )
    av.registrar_feedback(id2, aprovado=True)

    print("=== RELATÓRIO DE QUALIDADE ===")
    print(json.dumps(av.relatorio_qualidade(), indent=2, ensure_ascii=False))

    total_exportado = av.exportar_dataset_correcoes()
    print(f"\n{total_exportado} correções exportadas para dataset_correcoes.jsonl")
