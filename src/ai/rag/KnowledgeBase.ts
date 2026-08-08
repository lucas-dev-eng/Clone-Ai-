import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

export interface KnowledgeChunk {
  id: string;
  text: string;
  source: string;
  embedding?: number[];
  createdAt: string;
}

export interface SearchResult {
  text: string;
  source: string;
  score: number; // 0 to 1, higher is better
}

export class KnowledgeBase {
  private chunks: KnowledgeChunk[] = [];
  private filePath: string;
  private client: GoogleGenAI | null = null;

  constructor(persistencePath = "./chroma_db/knowledge_base.json") {
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

  private getClient(): GoogleGenAI | null {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("[KnowledgeBase] GEMINI_API_KEY not found in environment, embedding model will be disabled (using keyword-based matching).");
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

  /**
   * Splits a text into overlapping chunks
   */
  public splitIntoChunks(text: string, chunkSize = 800, overlap = 150): string[] {
    const chunks: string[] = [];
    let start = 0;
    const cleanText = text.replace(/\r\n/g, "\n").trim();

    if (cleanText.length <= chunkSize) {
      return [cleanText];
    }

    while (start < cleanText.length) {
      let end = start + chunkSize;
      if (end < cleanText.length) {
        // Try to break at a newline or space to keep readability
        const nextNewline = cleanText.indexOf("\n", end - 50);
        if (nextNewline !== -1 && nextNewline < end + 50) {
          end = nextNewline + 1;
        } else {
          const nextSpace = cleanText.indexOf(" ", end - 15);
          if (nextSpace !== -1 && nextSpace < end + 15) {
            end = nextSpace + 1;
          }
        }
      }

      const chunk = cleanText.substring(start, end).trim();
      if (chunk.length > 20) {
        chunks.push(chunk);
      }
      start = end - overlap;
    }

    return chunks;
  }

  /**
   * Generates a real Gemini vector embedding for a piece of text
   */
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
      console.error("[KnowledgeBase] Failed to generate embedding via Gemini API:", error);
    }
    return null;
  }

  /**
   * Ingests a raw text document with its source
   */
  public async ingestText(text: string, source: string): Promise<number> {
    if (!text || !text.trim()) return 0;
    
    const textChunks = this.splitIntoChunks(text);
    let ingestedCount = 0;

    for (const chunkText of textChunks) {
      const id = `${source}_chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let embedding: number[] | undefined;

      // Try generating real vector embedding
      const vector = await this.generateEmbedding(chunkText);
      if (vector) {
        embedding = vector;
      }

      const newChunk: KnowledgeChunk = {
        id,
        text: chunkText,
        source,
        embedding,
        createdAt: new Date().toISOString()
      };

      this.chunks.push(newChunk);
      ingestedCount++;
    }

    this.saveToDisk();
    return ingestedCount;
  }

  /**
   * Deletes all chunks associated with a specific source
   */
  public deleteBySource(source: string): boolean {
    const initialCount = this.chunks.length;
    this.chunks = this.chunks.filter(c => c.source !== source);
    this.saveToDisk();
    return this.chunks.length < initialCount;
  }

  /**
   * Searches the knowledge base using cosine similarity or keyword search
   */
  public async search(query: string, topK = 4): Promise<SearchResult[]> {
    if (this.chunks.length === 0) return [];

    const queryEmbedding = await this.generateEmbedding(query);

    // If we have query embeddings and chunk embeddings, do vector search
    if (queryEmbedding) {
      const results: SearchResult[] = [];
      for (const chunk of this.chunks) {
        if (chunk.embedding && chunk.embedding.length === queryEmbedding.length) {
          const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
          results.push({
            text: chunk.text,
            source: chunk.source,
            score: Math.max(0, Math.min(1, score))
          });
        } else {
          // Fallback to keyword overlap score scaled down
          const keywordScore = this.calculateKeywordScore(query, chunk.text) * 0.45;
          results.push({
            text: chunk.text,
            source: chunk.source,
            score: keywordScore
          });
        }
      }

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    // Fallback search: Keyword token overlap (extremely robust, no API key needed)
    console.log("[KnowledgeBase] Performing fallback text-overlap keyword matching search...");
    const results: SearchResult[] = this.chunks.map(chunk => {
      const score = this.calculateKeywordScore(query, chunk.text);
      return {
        text: chunk.text,
        source: chunk.source,
        score
      };
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
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

    // Return simple Jaccard-like ratio
    const unionSize = queryTokens.size + new Set(textTokens).size - matches;
    if (unionSize <= 0) return 0;
    return matches / unionSize;
  }

  /**
   * Returns metadata metrics
   */
  public getMetrics() {
    const sources = Array.from(new Set(this.chunks.map(c => c.source)));
    const chunksWithEmbeddings = this.chunks.filter(c => !!c.embedding).length;
    
    return {
      totalChunks: this.chunks.length,
      totalSources: sources.length,
      sources,
      chunksWithEmbeddings,
      percentageVectorized: this.chunks.length > 0 
        ? Math.round((chunksWithEmbeddings / this.chunks.length) * 100) 
        : 0
    };
  }

  /**
   * Clears all knowledge chunks
   */
  public clear() {
    this.chunks = [];
    this.saveToDisk();
  }

  /**
   * Saves database to disk
   */
  private saveToDisk() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.chunks, null, 2), "utf-8");
      console.log(`[KnowledgeBase] Successfully persisted ${this.chunks.length} chunks to disk.`);
    } catch (error) {
      console.error("[KnowledgeBase] Failed to save database to disk:", error);
    }
  }

  /**
   * Loads database from disk
   */
  private loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, "utf-8");
        this.chunks = JSON.parse(fileContent);
        console.log(`[KnowledgeBase] Successfully loaded ${this.chunks.length} chunks from ${this.filePath}.`);
      } else {
        console.log(`[KnowledgeBase] No persistent database found at ${this.filePath}. Starting fresh.`);
        this.chunks = [];
      }
    } catch (error) {
      console.error("[KnowledgeBase] Failed to load database from disk, starting empty:", error);
      this.chunks = [];
    }
  }
}

export const sharedKnowledgeBase = new KnowledgeBase();

