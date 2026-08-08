"""
agent_loop_multiprovider.py
==============================
Loop de execução de agente inteligente com múltiplos provedores,
integração com ferramentas locais (scanners de segurança) e loop de avaliação de qualidade.

Este arquivo reúne:
1. O esquema da ferramenta Trivy (TOOL_SCHEMA_TRIVY) e sua função executora (tool_rodar_trivy).
2. O roteador inteligente de múltiplos provedores que decide qual modelo/provedor usar.
3. O loop de execução do agente, decidindo quando chamar ferramentas.
4. O módulo de avaliação (eval_module.py) para registrar a interação e salvar feedbacks.
"""

import sys
import os
import json
import time

# Importando a ferramenta de scan de dependências do módulo recém-criado/atualizado
from tools_scanners import TOOL_SCHEMA_TRIVY, tool_rodar_trivy
from eval_module import Avaliador


class AgentLoopMultiProvider:
    def __init__(self, fallback_providers=None):
        self.avaliador = Avaliador()
        self.tools = {
            "rodar_trivy": tool_rodar_trivy
        }
        self.tool_schemas = [
            TOOL_SCHEMA_TRIVY
        ]
        self.providers = fallback_providers or ["gemini", "claude", "local"]

    def executar_agent_loop(self, pergunta: str) -> dict:
        """
        Executa um turno completo de loop do agente inteligente para responder à pergunta.
        Decide o provedor de forma resiliente, roda ferramentas se necessário, e
        registra a interação de forma sistematizada na base de avaliação.
        """
        print(f"\n[AgentLoop] Recebida a pergunta: '{pergunta}'")
        
        # 1. Escolha e Roteamento do Provedor (Simulando o roteamento multiprovedor robusto)
        # Se a pergunta pedir um scan de dependências, vamos priorizar modelos que usam as ferramentas disponíveis.
        provedor_escolhido = self.providers[0]
        print(f"[AgentLoop] Provedor escolhido pelo roteador: '{provedor_escolhido}'")
        
        start_time = time.time()
        log_chamadas_ferramentas = []
        texto_final = ""
        
        # 2. Detecção automática de arquivos de dependência no diretório atual
        arquivos_dep_comuns = ["package.json", "requirements.txt", "Gemfile", "go.mod", "Cargo.toml"]
        deps_detectadas = [f for f in arquivos_dep_comuns if os.path.exists(f)]
        
        # Verificação se o usuário solicita análise de segurança de infraestrutura
        solicitacao_infra = any(keyword in pergunta.lower() for keyword in [
            "infraestrutura", "infrastructure", "infra", "segurança de infra", "segurança de infraestrutura", "análise de segurança de infraestrutura"
        ])
        
        # Verificação se o usuário solicita scan ou ferramentas diretamente
        solicitacao_direta = any(keyword in pergunta.lower() for keyword in [
            "trivy", "depend", "scan", "vulnerabi", "cve", "sca"
        ])
        
        # Determinar alvo e tipo dinamicamente com base na pergunta do usuário
        alvo = "."
        tipo = "filesystem"
        
        pergunta_lower = pergunta.lower()
        # Se contiver termos relacionados a infraestrutura de container/docker, definimos tipo como image
        solicita_imagem = any(kw in pergunta_lower for kw in ["docker", "imagem", "image", "container", "alpine", "ubuntu", "nginx", "postgres", "redis", "node:"])
        
        if solicita_imagem or solicitacao_infra:
            tipo = "image"
            # Tentar extrair o nome da imagem da pergunta
            palavras = pergunta.split()
            for p in palavras:
                p_clean = p.strip(".\"'`,!?;()[]{}")
                if ":" in p_clean or p_clean in ["ubuntu", "alpine", "nginx", "redis", "postgres", "node", "python", "httpd"]:
                    alvo = p_clean
                    break
            if alvo == "." or "/" in alvo:  # se não encontrou imagem ou é caminho de arquivo
                alvo = "alpine:latest"  # default seguro/leve para fins de scan de container
        else:
            # Tentar extrair um caminho customizado do sistema de arquivos
            palavras = pergunta.split()
            for p in palavras:
                p_clean = p.strip(".\"'`,!?;()[]{}")
                if p_clean.startswith("/") or p_clean.endswith("/") or "/" in p_clean or p_clean in ["src", "dist", "server", "components"]:
                    alvo = p_clean
                    break

        # O agente decide utilizar o Trivy se detectar arquivos de dependências ou se for solicitado
        usa_ferramenta = len(deps_detectadas) > 0 or solicitacao_infra or solicitacao_direta
        
        if usa_ferramenta:
            motivo_gatilho = ""
            if solicita_imagem or (solicitacao_infra and tipo == "image"):
                motivo_gatilho = f"Solicitação de análise de segurança de infraestrutura (imagem Docker '{alvo}') detectada. Acionando scan com Trivy..."
            elif len(deps_detectadas) > 0 and alvo == ".":
                motivo_gatilho = f"Detectados arquivos de dependências locais ({', '.join(deps_detectadas)}). Acionando verificação automática..."
            elif solicitacao_infra:
                motivo_gatilho = f"Solicitação de análise de segurança de infraestrutura local ('{alvo}') detectada. Acionando scan com Trivy..."
            else:
                motivo_gatilho = f"Solicitação explícita de análise de dependências ou vulnerabilidades em '{alvo}' detectada."

            print(f"[AgentLoop] GATILHO TRIVY ATIVADO: {motivo_gatilho}")
            print(f"[AgentLoop] Chamando ferramenta 'rodar_trivy' com alvo='{alvo}' e tipo='{tipo}'...")
            
            # Executa de fato o scan no alvo e tipo especificados/extraídos
            t_start = time.time()
            resultado_ferramenta = tool_rodar_trivy(alvo=alvo, tipo=tipo)
            t_end = time.time()
            
            latencia_tool = t_end - t_start
            log_chamadas_ferramentas.append({
                "tool": "rodar_trivy",
                "args": {"alvo": alvo, "tipo": tipo},
                "resultado": f"Total achados: {resultado_ferramenta['total_achados']}",
                "latencia_s": latencia_tool
            })
            
            if resultado_ferramenta.get("erro"):
                texto_final = (
                    f"[{motivo_gatilho}]\n"
                    f"Iniciei o scan com o Trivy sobre '{alvo}' ({tipo}), mas ocorreu um erro: {resultado_ferramenta['erro']}"
                )
            else:
                texto_final = (
                    f"[{motivo_gatilho}]\n\n"
                    f"Rodei com sucesso a varredura do Trivy sobre o alvo de {tipo}: '{alvo}'.\n"
                    f"Resultados obtidos: Encontrei {resultado_ferramenta['total_achados']} vulnerabilidades conhecidas (CVEs) de severidade alta/crítica.\n"
                )
                if resultado_ferramenta['total_achados'] > 0:
                    texto_final += "Aqui está o resumo do que identifiquei:\n"
                    for finding in resultado_ferramenta['achados'][:3]:
                        texto_final += f"- Pct: {finding['pacote']} | CVE: {finding['id']} | {finding['titulo']} ({finding['severidade']})\n"
        else:
            # Resposta comum sem chamada de ferramentas
            texto_final = f"Olá! Posso te ajudar a realizar varreduras de dependências de segurança usando ferramentas como Trivy. Peça-me para 'rodar trivy' ou 'scanear dependências' para ver em ação."
            
        latencia_total = time.time() - start_time
        
        # 2. Registrar a Interação no Loop de Avaliação (eval_module)
        # O agente não só responde, como deixa tudo pronto para a UI ou auditores humanos
        # classificarem e darem feedback para gerar o dataset_correcoes.jsonl!
        id_interacao = self.avaliador.registrar_interacao(
            pergunta=pergunta,
            resposta=texto_final,
            tools_usadas=[l.get("tool") for l in log_chamadas_ferramentas if "tool" in l],
            provedor=provedor_escolhido,
            latencia_s=latencia_total
        )
        
        print(f"[AgentLoop] Interação gravada com ID: {id_interacao}")
        return {
            "id_interacao": id_interacao,
            "provedor_usado": provedor_escolhido,
            "resposta": texto_final,
            "latencia_total_s": latencia_total,
            "log": log_chamadas_ferramentas
        }


if __name__ == "__main__":
    print("=== INICIANDO AGENT LOOP MULTIPROVIDER COM SCAN DE DEPENDÊNCIAS ===")
    print(f"Diretório atual: {os.path.abspath(os.getcwd())}")
    
    agente = AgentLoopMultiProvider()
    
    # 1. Executa o loop de agente simulando uma pergunta de scan de dependências
    resultado_scan = agente.executar_agent_loop("Por favor, faça um scan de vulnerabilidades com Trivy nas dependências atuais.")
    print("\n=== RESPOSTA FINAL DO AGENTE (SCA DEPENDÊNCIAS) ===")
    print(resultado_scan["resposta"])
    print("====================================================")

    # 2. Executa o loop de agente simulando uma pergunta que solicita scan de infraestrutura (imagem Docker)
    resultado_infra_scan = agente.executar_agent_loop("Faça uma análise de segurança de infraestrutura na imagem docker nginx:alpine.")
    print("\n=== RESPOSTA FINAL DO AGENTE (INFRAESTRUTURA / CONTAINER) ===")
    print(resultado_infra_scan["resposta"])
    print("====================================================")
    
    # Demonstração de feedback sendo registrado logo após, caso houvesse alguma correção pelo usuário
    print("\n[Feedback] Simulando registro de feedback negativo e correção de memória de longo prazo...")
    agente.avaliador.registrar_feedback(
        id_interacao=resultado_scan["id_interacao"],
        aprovado=False,
        correcao="Recomende também a atualização do pacote vulnerável na resposta final do scan."
    )
    print("✅ Feedback gravado com sucesso. Dataset atualizado!")
