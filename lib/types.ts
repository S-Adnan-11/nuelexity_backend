export interface Source {
  id: number;
  title: string;
  url: string;
  snippet: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  followUps: string[];
  status: "complete" | "failed";
  created_at: string;
}
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
export interface Reservation {
  allowed: boolean;
  code?: string;
  remaining?: number;
  retryAfter?: number;
}
export interface Identity {
  subject: string;
  ipHash: string;
  userId: string | null;
}
export interface Store {
  verifyToken(token: string): Promise<string>;
  list(userId: string, offset: number): Promise<Conversation[]>;
  detail(userId: string, id: string): Promise<{ conversation: Conversation; messages: Message[] }>;
  remove(userId: string, id: string): Promise<void>;
  create(userId: string, query: string): Promise<Conversation>;
  save(
    userId: string,
    conversationId: string,
    message: Omit<Message, "id" | "created_at">,
  ): Promise<void>;
  reserve(identity: Identity, requestId: string): Promise<Reservation>;
  release(subject: string, requestId: string): Promise<void>;
  ready(): Promise<void>;
}
export interface Providers {
  search(query: string, signal: AbortSignal): Promise<Source[]>;
  answer(
    query: string,
    sources: Source[],
    history: Message[],
    signal: AbortSignal,
  ): AsyncIterable<string>;
  verifyGuest(token: string, ip: string, signal: AbortSignal): Promise<void>;
}
