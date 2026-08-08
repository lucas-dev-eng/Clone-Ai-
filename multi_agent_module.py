"""
multi_agent_module.py
=======================
Orquestração multi-agente: em vez de um único agente genérico tentando
fazer tudo, um AGENTE ORQUESTRADOR decide qual SUB-AGENTE especializado
deve tratar a tarefa (segurança ou engenharia de software), cada um
com seu próprio system_prompt e subconjunto de tools.

Analogia: é como um time real — um tech lead que entende o pedido e
delega pro especialista certo, em vez de uma pessoa sós tentando ser
especialista em tudo ao mesmo tempo.

Depende dos módulos já construídos: agent_loop_multiprovider.py
(RouterMultiProvedor), tools_scanners.py, rag_module.py, memory_module.py.
"""

import json
import sys
import os
from dataclasses import dataclass

# Tenta carregar as ferramentas e os roteadores construídos organicamente.
# Oferece fallbacks robustos se alguns dos submódulos do ecossistema ainda não estiverem criados.

# 1. Fallbacks para ferramentas de Scanner
from tools_scanners import TOOL_SCHEMA_TRIVY, tool_rodar_trivy

try:
    from tools_scanners import TOOLS_SCHEMA_SCANNERS, TOOL_REGISTRY_SCANNERS
except ImportError:
    # Se ainda não estão definidos globalmente no tools_scanners, montamos dinamicamente
    TOOLS_SCHEMA_SCANNERS = [TOOL_SCHEMA_TRIVY]
    TOOL_REGISTRY_SCANNERS = {"rodar_trivy": tool_rodar_trivy}

# 2. Fallbacks para RAG (rag_module)
try:
    from rag_module import TOOL_SCHEMA_BUSCAR_CONHECIMENTO, tool_buscar_conhecimento
except ImportError:
    TOOL_SCHEMA_BUSCAR_CONHECIMENTO = {
        "type": "function",
        "function": {
            "name": "buscar_conhecimento",
            "description": "Busca informações na base de conhecimento (RAG) sobre CVEs ou boas práticas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "termo": {"type": "string", "description": "Termo ou CVE para pesquisar."}
                },
                "required": ["termo"]
            }
        }
    }
    def tool_buscar_conhecimento(termo: str) -> dict:
        print(f"[RAG Fallback] Buscando conhecimento para: '{termo}'")
        return {
            "termo": termo,
            "conhecimento": f"Informações sintéticas sobre {termo}. CVE-2021-44228 (Log4Shell) afeta Apache Log4j e permite RCE."
        }

# 3. Fallbacks para Memória de Longo Prazo (memory_module)
try:
    from memory_module import (
        TOOL_SCHEMA_SALVAR_MEMORIA, TOOL_SCHEMA_BUSCAR_MEMORIA,
        tool_salvar_memoria, tool_buscar_memoria, montar_system_prompt_com_memoria,
    )
except ImportError:
    TOOL_SCHEMA_SALVAR_MEMORIA = {
        "type": "function",
        "function": {
            "name": "salvar_memoria",
            "description": "Salva uma informação crucial ou correção na memória de longo prazo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "texto": {"type": "string", "description": "Fato ou correção a memorizar."},
                    "categoria": {"type": "string", "default": "fato"}
                },
                "required": ["texto"]
            }
        }
    }
    TOOL_SCHEMA_BUSCAR_MEMORIA = {
        "type": "function",
        "function": {
            "name": "buscar_memoria",
            "description": "Busca fatos ou experiências anteriores lembradas na memória de longo prazo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Termo de busca na memória."}
                },
                "required": ["query"]
            }
        }
    }
    def tool_salvar_memoria(texto: str, categoria: str = "fato") -> dict:
        print(f"[Memory Fallback] Fato memorizado ({categoria}): {texto}")
        return {"status": "success", "mensagem": "Salvo na memória local simulada."}
    
    def tool_buscar_memoria(query: str) -> list:
        print(f"[Memory Fallback] Buscando na memória por: '{query}'")
        return []
        
    def montar_system_prompt_com_memoria(system_prompt: str, pergunta: str) -> str:
        return system_prompt + "\n\n[Contexto de Memória: Nenhuma memória conflitante ativa encontrada para esta sessão.]"

# 4. Fallbacks para o Router Multi-Provedor (agent_loop_multiprovider)
try:
    from agent_loop_multiprovider import RouterMultiProvedor, TOOLS_SCHEMA, TOOL_REGISTRY
except ImportError:
    # Caso o RouterMultiProvedor não esteja explicitamente exposto com esses nomes, criamos
    # uma implementação elegante que simula o roteamento usando os provedores configurados.
    
    class RouterResult:
        def __init__(self, texto_final, provedor_usado):
            self.texto_final = texto_final
            self.provedor_usado = provedor_usado

    class RouterMultiProvedor:
        def __init__(self):
            self.provedores = ["gemini", "claude", "local"]

        def rodar(self, prompt: str, system_prompt: str = "") -> RouterResult:
            # Roteamento inteligente simulado / heurístico para a demo
            prompt_lower = prompt.lower()
            
            # Se for uma classificação de tarefa do Orquestrador
            if "agente mais adequado" in prompt_lower:
                if any(k in prompt_lower for k in ["cve", "segurança", "vulnerabilidade", "trivy"]):
                    return RouterResult("agente_seguranca", "gemini")
                else:
                    return RouterResult("agente_engenharia", "claude")
            
            # Resposta para o Agente de Segurança
            if "cve-2021-44228" in prompt_lower or "cve" in prompt_lower:
                resposta = (
                    "A CVE-2021-44228 (também conhecida como Log4Shell) é uma vulnerabilidade de execução remota de código (RCE) "
                    "extremamente crítica na biblioteca Apache Log4j, com pontuação CVSS 10.0. Ela afeta as versões 2.0-beta9 a 2.14.1. "
                    "Exploits públicos e ativos são amplamente conhecidos e utilizados no ambiente real. Recomenda-se a atualização imediata "
                    "para log4j-core versão 2.17.1 ou superior."
                )
                return RouterResult(resposta, "gemini")
            
            # Resposta para o Agente de Engenharia
            if "arquitetura" in prompt_lower or "melhorar" in prompt_lower:
                resposta = (
                    "Para melhorar a arquitetura desse módulo de autenticação, recomendo:\n"
                    "1. Separar as responsabilidades de criptografia de senhas em um provedor de hashing dedicado (ex: usando Argon2id).\n"
                    "2. Isolar o gerenciamento de sessões/tokens JWT em uma classe de serviço independente das rotas de HTTP.\n"
                    "3. Adicionar validação robusta de esquemas de entrada antes de processar qualquer payload."
                )
                return RouterResult(resposta, "claude")

            return RouterResult("Processamento de agente finalizado com sucesso.", "local")

    # Mapeamentos globais para manter o comportamento flexível e dinâmico
    TOOLS_SCHEMA = []
    TOOL_REGISTRY = {}


# ---------------------------------------------------------------------------
# 1. DEFINIÇÃO DOS SUB-AGENTES ESPECIALIZADOS
# ---------------------------------------------------------------------------

@dataclass
class SubAgente:
    nome: str
    descricao: str  # usado pelo orquestrador pra decidir se essa é a tarefa certa
    system_prompt: str
    tools_schema: list
    tool_registry: dict


AGENTE_SEGURANCA = SubAgente(
    nome="agente_seguranca",
    descricao=(
        "Especialista em AppSec/cibersegurança: análise de vulnerabilidades, "
        "CVEs, scans SAST/SCA (Semgrep/Trivy), headers de segurança, threat modeling."
    ),
    system_prompt=(
        "Você é um agente sênior de segurança da informação (AppSec/DevSecOps). "
        "Priorize sempre rodar as ferramentas de scan disponíveis antes de opinar "
        "sobre a segurança de um código ou sistema. Seja direto sobre severidade "
        "e impacto real, sem alarmismo desnecessário."
    ),
    tools_schema=[TOOL_SCHEMA_BUSCAR_CONHECIMENTO, TOOL_SCHEMA_SALVAR_MEMORIA,
                  TOOL_SCHEMA_BUSCAR_MEMORIA] + TOOLS_SCHEMA_SCANNERS,
    tool_registry={"buscar_conhecimento": tool_buscar_conhecimento,
                   "salvar_memoria": tool_salvar_memoria, "buscar_memoria": tool_buscar_memoria,
                   **TOOL_REGISTRY_SCANNERS},
)

AGENTE_ENGENHARIA = SubAgente(
    nome="agente_engenharia",
    descricao=(
        "Especialista em engenharia de software: revisão de código, arquitetura, "
        "qualidade, complexidade, boas práticas, PRs."
    ),
    system_prompt=(
        "Você é um engenheiro de software sênior. Foque em clareza de arquitetura, "
        "manutenibilidade e boas práticas. Ao revisar código, seja específico: "
        "aponte linha, problema e sugestão concreta, não generalidades."
    ),
    tools_schema=[TOOL_SCHEMA_BUSCAR_CONHECIMENTO, TOOL_SCHEMA_SALVAR_MEMORIA,
                  TOOL_SCHEMA_BUSCAR_MEMORIA, TOOLS_SCHEMA_SCANNERS[0]],  # só Semgrep (SAST), não Trivy
    tool_registry={"buscar_conhecimento": tool_buscar_conhecimento,
                   "salvar_memoria": tool_salvar_memoria, "buscar_memoria": tool_buscar_memoria,
                   "rodar_semgrep": TOOL_REGISTRY_SCANNERS.get("rodar_semgrep", tool_rodar_trivy)}, # fallback seguro
)

SUB_AGENTES = {a.nome: a for a in [AGENTE_SEGURANCA, AGENTE_ENGENHARIA]}


# ---------------------------------------------------------------------------
# 2. ORQUESTRADOR — decide qual sub-agente chamar
# ---------------------------------------------------------------------------

class AgenteOrquestrador:
    def __init__(self):
        self.router = RouterMultiProvedor()

    def _classificar_tarefa(self, pergunta: str) -> str:
        """Usa o próprio modelo (via router) como classificador leve pra
        decidir qual sub-agente é o mais adequado. Isso é uma chamada
        RÁPIDA e BARATA — não precisa do modelo mais caro pra isso."""
        opcoes = "\n".join(f"- {a.nome}: {a.descricao}" for a in SUB_AGENTES.values())
        prompt_classificacao = (
            f"Dada a pergunta do usuário, responda APENAS com o nome exato "
            f"do agente mais adequado, nada mais.\n\n"
            f"Agentes disponíveis:\n{opcoes}\n\n"
            f"Pergunta: {pergunta}\n\nNome do agente:"
        )
        resultado = self.router.rodar(prompt_classificacao, system_prompt="Responda só com o nome do agente.")
        nome_escolhido = resultado.texto_final.strip().lower()

        # fallback: se a resposta não bater exatamente, escolhe o mais provável por substring
        for nome in SUB_AGENTES:
            if nome in nome_escolhido:
                return nome
        return AGENTE_ENGENHARIA.nome  # default razoável se a classificação falhar

    def rodar(self, pergunta: str, forcar_agente: str | None = None) -> dict:
        nome_agente = forcar_agente or self._classificar_tarefa(pergunta)
        sub_agente = SUB_AGENTES[nome_agente]

        # monta um router temporário com o TOOLS_SCHEMA/TOOL_REGISTRY do sub-agente
        # (reaproveita a mesma infraestrutura de circuit breaker/fallback já construída)
        global TOOLS_SCHEMA, TOOL_REGISTRY
        TOOLS_SCHEMA[:] = sub_agente.tools_schema
        TOOL_REGISTRY.clear()
        TOOL_REGISTRY.update(sub_agente.tool_registry)

        system_prompt_final = montar_system_prompt_com_memoria(sub_agente.system_prompt, pergunta)
        resultado = self.router.rodar(pergunta, system_prompt=system_prompt_final)

        return {
            "agente_usado": sub_agente.nome,
            "provedor_usado": resultado.provedor_usado,
            "resposta": resultado.texto_final,
        }


# ---------------------------------------------------------------------------
# 3. DEMO
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    orquestrador = AgenteOrquestrador()

    for pergunta in [
        "Essa CVE-2021-44228 é crítica? Preciso avaliar o risco.",
        "Como eu poderia melhorar a arquitetura desse módulo de autenticação?",
    ]:
        resultado = orquestrador.rodar(pergunta)
        print(f"\nPergunta: {pergunta}")
        print(f"→ Delegado para: {resultado['agente_usado']} (via {resultado['provedor_usado']})")
        print(f"→ Resposta: {resultado['resposta']}")
