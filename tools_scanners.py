"""
tools_scanners.py
===================
Módulo contendo definições de esquemas de ferramentas (tools) e
funções executoras para ferramentas de varredura de segurança (scanners).

Neste arquivo, definimos o TOOL_SCHEMA_TRIVY para declarar os parâmetros que
o agente precisa para chamar o scanner, e a função executora tool_rodar_trivy
que realiza a varredura real do sistema de arquivos ou de imagens Docker.
"""

import subprocess
import json
import os

TOOL_SCHEMA_TRIVY = {
    "type": "function",
    "function": {
        "name": "rodar_trivy",
        "description": "Roda um scan de dependências (SCA) com Trivy sobre um caminho local ou uma imagem de container, retornando vulnerabilidades conhecidas (CVEs).",
        "parameters": {
            "type": "object",
            "properties": {
                "alvo": {
                    "type": "string",
                    "description": "Caminho do diretório local ou nome da imagem Docker a escanear. Se omitido, escaneia o diretório atual.",
                    "default": "."
                },
                "tipo": {
                    "type": "string",
                    "description": "Tipo do alvo: 'filesystem' para diretórios locais ou 'image' para imagens docker.",
                    "enum": ["filesystem", "image"],
                    "default": "filesystem"
                }
            }
        }
    }
}

def tool_rodar_trivy(alvo: str = ".", tipo: str = "filesystem") -> dict:
    """
    Roda o scanner Trivy para buscar vulnerabilidades de segurança
    no alvo especificado (diretório local ou imagem Docker) e retorna os achados.
    Garante permissão de scan de dependências no diretório atual.
    """
    subcomando = "fs" if tipo == "filesystem" else "image"
    
    # Se o alvo for o diretório atual ou estiver vazio, resolvemos para o caminho absoluto
    if alvo == "." or not alvo:
        alvo = os.path.abspath(os.getcwd())

    cmd = ["trivy", subcomando, "--format", "json", "--severity", "HIGH,CRITICAL", alvo]
    
    try:
        # Verifica de forma segura e não obstrutiva se o executável trivy está instalado
        result_ver = subprocess.run(["which", "trivy"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result_ver.returncode != 0:
            return {
                "total_achados": 0,
                "achados": [],
                "erro": "Trivy não instalado no ambiente. Instale-o primeiro para rodar o scan de dependências."
            }
    except Exception:
        return {
            "total_achados": 0,
            "achados": [],
            "erro": "Não foi possível verificar a instalação do Trivy no sistema operacional."
        }

    try:
        resultado = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        if resultado.returncode != 0 and not resultado.stdout:
            return {
                "total_achados": 0,
                "achados": [],
                "erro": f"Erro durante a execução do Trivy: {resultado.stderr.strip()}"
            }
            
        data = json.loads(resultado.stdout)
        findings = []
        
        results = data.get("Results", [])
        for res in results:
            vulnerabilities = res.get("Vulnerabilities", [])
            for vuln in vulnerabilities:
                findings.append({
                    "id": vuln.get("VulnerabilityID", "N/A"),
                    "pacote": vuln.get("PkgName", "N/A"),
                    "versao_instalada": vuln.get("InstalledVersion", "N/A"),
                    "versao_corrigida": vuln.get("FixedVersion", "N/A"),
                    "severidade": vuln.get("Severity", "N/A"),
                    "titulo": vuln.get("Title", "N/A"),
                    "descricao": vuln.get("Description", "N/A")
                })
                
        return {
            "total_achados": len(findings),
            "achados": findings,
            "erro": None
        }
    except json.JSONDecodeError:
        return {
            "total_achados": 0,
            "achados": [],
            "erro": "O Trivy executou, mas o output retornado não é um JSON válido."
        }
    except Exception as e:
        return {
            "total_achados": 0,
            "achados": [],
            "erro": f"Exceção ocorrida ao chamar Trivy: {str(e)}"
        }
