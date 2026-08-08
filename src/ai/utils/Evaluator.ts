import * as fs from "fs";
import * as path from "path";
import { sharedMemoryBase } from "../rag/MemoryBase";

export interface Interaction {
  id: string;
  pergunta: string;
  resposta: string;
  tools_usadas: string[];
  provedor: string;
  latencia_s: number;
  criado_em: number;
  aprovado: boolean | null; // null = pending, false = reprovado, true = aprovado
  correcao?: string | null;
}

export class Evaluator {
  private interactions: Interaction[] = [];
  private filePath: string;

  constructor(persistencePath = "./chroma_db/agent_evaluations.json") {
    this.filePath = persistencePath;
    this.ensureDirectoryExistence(this.filePath);
    this.loadFromDisk();
  }

  private ensureDirectoryExistence(filePath: string) {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }
  }

  /**
   * Registers a new agent interaction
   */
  public registrar_interacao(
    pergunta: string,
    resposta: string,
    tools_usadas: string[],
    provedor: string,
    latencia_s: number
  ): string {
    const id_interacao = `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newInteraction: Interaction = {
      id: id_interacao,
      pergunta: pergunta.trim(),
      resposta: resposta.trim(),
      tools_usadas,
      provedor,
      latencia_s,
      criado_em: Date.now() / 1000,
      aprovado: null,
      correcao: null,
    };

    this.interactions.push(newInteraction);
    this.saveToDisk();
    return id_interacao;
  }

  /**
   * Registers feedback for a given interaction ID
   */
  public async registrar_feedback(
    id_interacao: string,
    aprovado: boolean,
    correcao?: string | null
  ): Promise<boolean> {
    const idx = this.interactions.findIndex((i) => i.id === id_interacao);
    if (idx === -1) {
      console.warn(`[Evaluator] Interaction with ID ${id_interacao} not found.`);
      return false;
    }

    this.interactions[idx].aprovado = aprovado;
    this.interactions[idx].correcao = correcao || null;
    this.saveToDisk();

    // Close the loop: if approved is false and a correction is provided,
    // save it as a long-term memory of category "correcao".
    if (!aprovado && correcao && correcao.trim()) {
      try {
        await sharedMemoryBase.saveFact(
          `Correção de erro registrada para pergunta: "${this.interactions[idx].pergunta}". Correção: ${correcao}`,
          "correcao"
        );
        console.log(`[Evaluator] Automatically saved correction to Long Term Memory.`);
      } catch (e) {
        console.error("[Evaluator] Failed to save correction to Long Term Memory:", e);
      }
    }

    return true;
  }

  /**
   * Compiles quality reports across evaluated interactions
   */
  public relatorio_qualidade(): Record<string, any> {
    const evaluated = this.interactions.filter((i) => i.aprovado !== null);
    const total = evaluated.length;

    if (total === 0) {
      return {
        total_avaliadas: 0,
        taxa_aprovacao: 0,
        falhas_por_provedor: {},
        falhas_por_tool: {},
        total_geral: this.interactions.length,
      };
    }

    const aprovadas = evaluated.filter((i) => i.aprovado === true).length;
    const falhas_por_provedor: Record<string, number> = {};
    const falhas_por_tool: Record<string, number> = {};

    for (const i of evaluated) {
      if (i.aprovado === false) {
        // Count provider failure
        falhas_por_provedor[i.provedor] = (falhas_por_provedor[i.provedor] || 0) + 1;

        // Count tool failures
        if (i.tools_usadas && i.tools_usadas.length > 0) {
          for (const t of i.tools_usadas) {
            falhas_por_tool[t] = (falhas_por_tool[t] || 0) + 1;
          }
        }
      }
    }

    return {
      total_avaliadas: total,
      taxa_aprovacao: Number((aprovadas / total).toFixed(3)),
      falhas_por_provedor,
      falhas_por_tool,
      total_geral: this.interactions.length,
    };
  }

  /**
   * Exports correct/wrong pairs to a JSONL file for fine-tuning
   */
  public exportar_dataset_correcoes(caminho_saida = "./dataset_correcoes.jsonl"): number {
    const reproved = this.interactions.filter((i) => i.aprovado === false && i.correcao);
    const lines: string[] = [];

    for (const i of reproved) {
      lines.push(
        JSON.stringify({
          pergunta: i.pergunta,
          resposta_errada: i.resposta,
          resposta_corrigida: i.correcao,
        })
      );
    }

    try {
      const parentDir = path.dirname(caminho_saida);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(caminho_saida, lines.join("\n") + "\n", "utf-8");
      console.log(`[Evaluator] Exported ${reproved.length} entries to ${caminho_saida}`);
    } catch (e) {
      console.error("[Evaluator] Failed to export corrections to dataset:", e);
    }

    return reproved.length;
  }

  /**
   * Returns all recorded interactions (for debugging/visualisation)
   */
  public getAllInteractions(): Interaction[] {
    return [...this.interactions];
  }

  private saveToDisk() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.interactions, null, 2), "utf-8");
    } catch (e) {
      console.error("[Evaluator] Failed to save evaluations to disk:", e);
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, "utf-8");
        this.interactions = JSON.parse(fileContent);
        console.log(`[Evaluator] Loaded ${this.interactions.length} evaluations from ${this.filePath}.`);
      } else {
        console.log(`[Evaluator] No evaluations file found. Starting fresh.`);
        this.interactions = [];
      }
    } catch (e) {
      console.error("[Evaluator] Failed to load evaluations from disk:", e);
      this.interactions = [];
    }
  }
}

export const sharedEvaluator = new Evaluator();
