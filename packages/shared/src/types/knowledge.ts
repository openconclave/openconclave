export interface KnowledgeBase {
  id: number;
  name: string;
  description?: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: number;
  knowledgeBaseId: number;
  filename: string;
  sourcePath?: string;
  content?: string;
  contentHash: string;
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: number;
  documentId: number;
  content: string;
  metadata: Record<string, unknown>;
  chunkIndex: number;
}

export interface KnowledgeSearchResult {
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  knowledgeBaseId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
}
