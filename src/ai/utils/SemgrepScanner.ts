import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

export interface SemgrepFinding {
  rule: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  line: number;
  col?: number;
  filePath: string;
  codeSnippet?: string;
}

export interface SemgrepScanResult {
  totalFindings: number;
  findings: SemgrepFinding[];
  error?: string;
}

/**
 * Detect language extension based on code heuristic
 */
export function detectExtension(code: string): string {
  const trimmed = code.trim();
  if (trimmed.startsWith("import ") || trimmed.startsWith("from ") || trimmed.includes("def ") || trimmed.includes("elif ")) {
    if (trimmed.includes("def ") || trimmed.includes("import os") || trimmed.includes("import sys")) {
      return ".py";
    }
  }
  if (trimmed.includes("package ") && trimmed.includes("func ")) {
    return ".go";
  }
  if (trimmed.includes("class ") && (trimmed.includes("public static void main") || trimmed.includes("System.out.print"))) {
    return ".java";
  }
  if (trimmed.includes("#include <") || trimmed.includes("int main(")) {
    return ".cpp";
  }
  if (trimmed.includes("interface ") || trimmed.includes("type ") || trimmed.includes("export ")) {
    return ".ts";
  }
  return ".js";
}

/**
 * Parses a unified diff to extract file paths and their newly added lines
 */
export function parseDiff(diff: string): Record<string, string> {
  const files: Record<string, string> = {};
  const lines = diff.split("\n");
  let currentFile = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      // Save previous file
      if (currentFile && currentContent.length > 0) {
        files[currentFile] = currentContent.join("\n");
      }
      // Start new file
      const rawPath = line.startsWith("+++ b/") ? line.substring(6) : line.substring(4);
      currentFile = rawPath.trim();
      currentContent = [];
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentContent.push(line.substring(1));
    }
  }
  if (currentFile && currentContent.length > 0) {
    files[currentFile] = currentContent.join("\n");
  }
  return files;
}

/**
 * Executes a Semgrep SAST scan on a target file or directory
 */
export function runSemgrepScan(targetPath: string): SemgrepScanResult {
  let stdoutStr = "";
  try {
    stdoutStr = execSync(`semgrep --config=auto --json "${targetPath}"`, {
      encoding: "utf-8",
      maxBuffer: 15 * 1024 * 1024, // 15MB buffer
      timeout: 30000 // 30s timeout
    });
  } catch (err: any) {
    // Semgrep exits with non-zero on findings or execution issues
    stdoutStr = err.stdout || "";
    if (!stdoutStr && err.stderr) {
      console.error("[SemgrepScanner] Semgrep execution stderr:", err.stderr);
    }
  }

  if (!stdoutStr || !stdoutStr.trim()) {
    return { totalFindings: 0, findings: [] };
  }

  try {
    const parsed = JSON.parse(stdoutStr);
    const results = parsed.results || [];
    const findings: SemgrepFinding[] = results.map((r: any) => ({
      rule: r.check_id || "unknown-rule",
      severity: r.extra?.severity || "WARNING",
      message: r.extra?.message || "Semgrep finding",
      line: r.start?.line || 1,
      col: r.start?.col,
      filePath: r.path || "unknown",
      codeSnippet: r.extra?.lines || ""
    }));

    return {
      totalFindings: findings.length,
      findings
    };
  } catch (parseError: any) {
    console.error("[SemgrepScanner] Failed to parse Semgrep JSON output:", parseError, stdoutStr);
    return {
      totalFindings: 0,
      findings: [],
      error: `Erro ao analisar o JSON do Semgrep: ${parseError.message}`
    };
  }
}

/**
 * Writes code to a temporary file and runs a Semgrep scan
 */
export function scanCodeString(code: string, language?: string): SemgrepScanResult {
  let ext = "";
  if (language) {
    const lang = language.toLowerCase().trim();
    if (lang === "python" || lang === "py") ext = ".py";
    else if (lang === "javascript" || lang === "js" || lang === "node") ext = ".js";
    else if (lang === "typescript" || lang === "ts" || lang === "tsx") ext = ".ts";
    else if (lang === "java") ext = ".java";
    else if (lang === "go" || lang === "golang") ext = ".go";
    else if (lang === "c++" || lang === "cpp" || lang === "cc") ext = ".cpp";
    else if (lang === "c") ext = ".c";
    else if (lang === "ruby" || lang === "rb") ext = ".rb";
    else if (lang === "php") ext = ".php";
  }
  if (!ext) {
    ext = detectExtension(code);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-code-"));
  const tempFile = path.join(tempDir, `source${ext}`);

  try {
    fs.writeFileSync(tempFile, code, "utf-8");
    const result = runSemgrepScan(tempDir);
    
    // Normalize file paths to be relative/clean
    result.findings = result.findings.map(f => ({
      ...f,
      filePath: f.filePath.replace(tempDir, "codigo_analisado")
    }));

    return result;
  } catch (err: any) {
    return {
      totalFindings: 0,
      findings: [],
      error: `Falha ao preparar o arquivo para o Semgrep: ${err.message}`
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch (e) {
      console.error("[SemgrepScanner] Cleanup error:", e);
    }
  }
}

/**
 * Reconstruction of added files from unified diff, scanned with Semgrep
 */
export function scanDiffString(diff: string): SemgrepScanResult {
  const files = parseDiff(diff);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-diff-"));

  try {
    const fileKeys = Object.keys(files);
    if (fileKeys.length === 0) {
      // Revert to treating entire diff as a single code string if it's not a unified diff format
      const ext = detectExtension(diff);
      const tempFile = path.join(tempDir, `diff_block${ext}`);
      fs.writeFileSync(tempFile, diff, "utf-8");
    } else {
      for (const relPath of fileKeys) {
        const destPath = path.join(tempDir, relPath);
        const parentDir = path.dirname(destPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(destPath, files[relPath], "utf-8");
      }
    }

    const result = runSemgrepScan(tempDir);

    // Normalize paths
    result.findings = result.findings.map(f => ({
      ...f,
      filePath: f.filePath.replace(tempDir, "").replace(/^\//, "")
    }));

    return result;
  } catch (err: any) {
    return {
      totalFindings: 0,
      findings: [],
      error: `Falha ao processar diff para Semgrep: ${err.message}`
    };
  } finally {
    try {
      recursiveCleanup(tempDir);
    } catch (e) {
      console.error("[SemgrepScanner] Recursive cleanup error:", e);
    }
  }
}

/**
 * Recursive directory deletion helper
 */
function recursiveCleanup(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        recursiveCleanup(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    }
    fs.rmdirSync(dirPath);
  }
}
