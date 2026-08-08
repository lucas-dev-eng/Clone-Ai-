import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import { db } from "../../db/index.ts";
import { memories as memoriesTable } from "../../db/schema.ts";
import { eq } from "drizzle-orm";

export interface Fact {
  id: string;
  text: string;
  category: "preferencia" | "decisao" | "contexto_projeto" | "correcao" | "geral";
  createdAt: string;
  embedding?: number[];
  relevance?: number;
}

export class MemoryBase {
  private facts: Fact[] = [];
  private filePath: string;
  private client: GoogleGenAI | null = null;

  constructor(persistencePath = "./chroma_db/long_term_memory.json") {
    this.filePath = persistencePath;
    this.ensureDirectoryExistence(this.filePath);
    this.loadFromDisk();
    this.loadFromDb();
  }

  private ensureDirectoryExistence(filePath: string) {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }
  }

  private async loadFromDb() {
    try {
      const rows = await db.select().from(memoriesTable);
      this.facts = rows.map(r => ({
        id: r.id,
        text: r.text,
        category: r.category as any,
        createdAt: r.createdAt.toISOString(),
        embedding: r.embedding ? (r.embedding as number[]) : undefined
      }));
      console.log(`[MemoryBase] Loaded ${this.facts.length} memory facts from PostgreSQL.`);
    } catch (e) {
      console.warn("[MemoryBase] PostgreSQL not yet ready or table missing during loadFromDb. Using disk cache.", e);
    }
  }

  private getClient(): GoogleGenAI | null {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return null;
      }
      this.client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return this.client;
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      const response = await client.models.embedContent({
        model: "text-embedding-004",
        contents: text,
      });

      const embeddingValues = (response as any)?.embedding?.values;
      if (Array.isArray(embeddingValues) && embeddingValues.length > 0) {
        return embeddingValues;
      }
    } catch (error) {
      console.error("[MemoryBase] Failed to generate embedding:", error);
    }
    return null;
  }

  /**
   * Saves a new fact persistently
   */
  public async saveFact(text: string, category: Fact["category"] = "geral", userId?: string): Promise<string> {
    const id = `fact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let embedding: number[] | undefined;

    const vector = await this.generateEmbedding(text);
    if (vector) {
      embedding = vector;
    }

    const newFact: Fact = {
      id,
      text: text.trim(),
      category,
      createdAt: new Date().toISOString(),
      embedding,
    };

    this.facts.push(newFact);
    this.saveToDisk();

    try {
      await db.insert(memoriesTable).values({
        id,
        userId: userId || null,
        text: text.trim(),
        category,
        embedding: embedding || null,
        createdAt: new Date()
      });
      console.log(`[MemoryBase] Successfully saved memory fact ${id} to PostgreSQL.`);
    } catch (error) {
      console.error("[MemoryBase] Failed to save to PostgreSQL, using disk fallback:", error);
    }

    return id;
  }

  /**
   * Retrieves relevant facts for the given context
   */
  public async searchRelevantFacts(context: string, topK = 5, minSimilarity = 0.35, userId?: string): Promise<Fact[]> {
    let activeFacts: Fact[] = [];
    try {
      const rows = userId
        ? await db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId))
        : await db.select().from(memoriesTable);

      activeFacts = rows.map(r => ({
        id: r.id,
        text: r.text,
        category: r.category as any,
        createdAt: r.createdAt.toISOString(),
        embedding: r.embedding ? (r.embedding as number[]) : undefined
      }));
    } catch (e) {
      console.warn("[MemoryBase] Failed to query PostgreSQL, falling back to local memory list.", e);
      activeFacts = this.facts;
    }

    if (activeFacts.length === 0) return [];

    const queryEmbedding = await this.generateEmbedding(context);

    if (queryEmbedding) {
      const results: Fact[] = [];
      for (const fact of activeFacts) {
        if (fact.embedding && fact.embedding.length === queryEmbedding.length) {
          const score = this.cosineSimilarity(queryEmbedding, fact.embedding);
          if (score >= minSimilarity) {
            results.push({
              ...fact,
              relevance: Number(score.toFixed(3)),
            });
          }
        } else {
          const keywordScore = this.calculateKeywordScore(context, fact.text);
          if (keywordScore >= minSimilarity - 0.1) {
            results.push({
              ...fact,
              relevance: Number(keywordScore.toFixed(3)),
            });
          }
        }
      }

      return results
        .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
        .slice(0, topK);
    }

    // Fallback search: Keyword overlap
    const results: Fact[] = activeFacts.map(fact => {
      const score = this.calculateKeywordScore(context, fact.text);
      return {
        ...fact,
        relevance: Number(score.toFixed(3)),
      };
    });

    return results
      .filter(f => (f.relevance || 0) >= minSimilarity)
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, topK);
  }

  /**
   * Deletes a fact by id
   */
  public deleteFact(id: string): boolean {
    const initialLength = this.facts.length;
    this.facts = this.facts.filter(f => f.id !== id);
    this.saveToDisk();

    db.delete(memoriesTable).where(eq(memoriesTable.id, id))
      .then(() => console.log(`[MemoryBase] Deleted memory fact ${id} from PostgreSQL.`))
      .catch(e => console.error("[MemoryBase] Failed to delete from PostgreSQL:", e));

    return true;
  }

  /**
   * Returns all facts
   */
  public getAllFacts(userId?: string): Fact[] {
    // Return current memory-cached facts (without embeddings) for instantaneous responses
    return [...this.facts].map(f => ({ ...f, embedding: undefined }));
  }

  public async getAllFactsAsync(userId?: string): Promise<Fact[]> {
    try {
      const rows = userId
        ? await db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId))
        : await db.select().from(memoriesTable);

      return rows.map(r => ({
        id: r.id,
        text: r.text,
        category: r.category as any,
        createdAt: r.createdAt.toISOString()
      }));
    } catch (e) {
      console.warn("[MemoryBase] Failed to fetch facts from DB, using cached facts instead.", e);
      return this.getAllFacts(userId);
    }
  }

  /**
   * Clears entire memory
   */
  public clear(userId?: string): void {
    this.facts = [];
    this.saveToDisk();

    const deleteQuery = userId
      ? db.delete(memoriesTable).where(eq(memoriesTable.userId, userId))
      : db.delete(memoriesTable);

    deleteQuery
      .then(() => console.log(`[MemoryBase] Cleared memories from PostgreSQL.`))
      .catch(e => console.error("[MemoryBase] Failed to clear memories from PostgreSQL:", e));
  }


  /**
   * Formats the relevant memory list for injection into system prompts
   */
  public async formatSystemPromptWithMemory(basePrompt: string, query: string, userId?: string): Promise<string> {
    const relevantFacts = await this.searchRelevantFacts(query, 5, 0.4, userId);
    if (relevantFacts.length === 0) {
      return basePrompt;
    }

    const factsBlock = relevantFacts.map(f => `- [${f.category}] ${f.text}`).join("\n");
    return `${basePrompt}\n\nFatos e preferências relevantes sobre este usuário e projeto (use essas informações se forem pertinentes à pergunta/tarefa atual):\n${factsBlock}`;
  }

  /**
   * Cosine similarity helper
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      mA += a[i] * a[i];
      mB += b[i] * b[i];
    }
    if (mA === 0 || mB === 0) return 0;
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
  }

  /**
   * Fast keyword token overlap similarity score calculation
   */
  private calculateKeywordScore(query: string, text: string): number {
    const cleanTokens = (str: string) => {
      return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
        .split(/\s+/)
        .filter(t => t.length > 2); // filter out short connector words
    };

    const queryTokens = new Set(cleanTokens(query));
    const textTokens = cleanTokens(text);

    if (queryTokens.size === 0 || textTokens.length === 0) return 0;

    let matches = 0;
    for (const token of textTokens) {
      if (queryTokens.has(token)) {
        matches++;
      }
    }

    const unionSize = queryTokens.size + new Set(textTokens).size - matches;
    if (unionSize <= 0) return 0;
    return matches / unionSize;
  }

  private saveToDisk() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.facts, null, 2), "utf-8");
      console.log(`[MemoryBase] Persisted ${this.facts.length} memory facts to disk.`);
    } catch (e) {
      console.error("[MemoryBase] Failed to save memory facts to disk:", e);
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, "utf-8");
        this.facts = JSON.parse(fileContent);
        console.log(`[MemoryBase] Loaded ${this.facts.length} memory facts from ${this.filePath}.`);
      } else {
        console.log(`[MemoryBase] No memory facts database found. Starting fresh.`);
        this.facts = [];
      }
    } catch (e) {
      console.error("[MemoryBase] Failed to load memory facts from disk:", e);
      this.facts = [];
    }
  }
}

export const sharedMemoryBase = new MemoryBase();
