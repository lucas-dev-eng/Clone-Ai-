import { execSync } from "child_process";

export interface TrivyVulnerability {
  pacote: string;
  versao_instalada: string;
  cve: string;
  severidade: string;
  versao_corrigida: string;
}

export interface TrivyScanResult {
  totalFindings: number;
  findings: TrivyVulnerability[];
  error?: string;
}

/**
 * Runs a Trivy vulnerability scan on a target path or docker image
 */
export function runTrivyScan(alvo: string, tipo: "filesystem" | "image" = "filesystem"): TrivyScanResult {
  const subcomando = tipo === "filesystem" ? "fs" : "image";
  let stdoutStr = "";

  try {
    // Executing Trivy via CLI with json format
    stdoutStr = execSync(`trivy ${subcomando} --format json --severity HIGH,CRITICAL "${alvo}"`, {
      encoding: "utf-8",
      maxBuffer: 25 * 1024 * 1024, // 25MB buffer
      timeout: 120000 // 120s timeout
    });
  } catch (err: any) {
    stdoutStr = err.stdout || "";
    if (!stdoutStr && err.stderr) {
      console.error("[TrivyScanner] Trivy execution stderr:", err.stderr);
    }
  }

  if (!stdoutStr || !stdoutStr.trim()) {
    // If no stdout is found and we have an error or empty result, check if it's because trivy isn't installed
    try {
      execSync("which trivy");
    } catch {
      return {
        totalFindings: 0,
        findings: [],
        error: "Trivy não encontrado. Instale: https://aquasecurity.github.io/trivy/latest/getting-started/installation/"
      };
    }
    return { totalFindings: 0, findings: [] };
  }

  try {
    const parsed = JSON.parse(stdoutStr);
    const results = parsed.Results || [];
    const findings: TrivyVulnerability[] = [];

    for (const resultItem of results) {
      const vulnerabilities = resultItem.Vulnerabilities || [];
      for (const vuln of vulnerabilities) {
        findings.push({
          pacote: vuln.PkgName || "desconhecido",
          versao_instalada: vuln.InstalledVersion || "N/A",
          cve: vuln.VulnerabilityID || "N/A",
          severidade: vuln.Severity || "HIGH",
          versao_corrigida: vuln.FixedVersion || "sem correção disponível"
        });
      }
    }

    return {
      totalFindings: findings.length,
      findings
    };
  } catch (parseError: any) {
    console.error("[TrivyScanner] Failed to parse Trivy JSON output:", parseError);
    return {
      totalFindings: 0,
      findings: [],
      error: `Falha ao analisar o JSON do Trivy: ${parseError.message}`
    };
  }
}
