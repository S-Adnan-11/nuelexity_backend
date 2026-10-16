import { createSupabaseClient } from "../client.js";
import type { SupabaseFetch } from "../client.js";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import type { Conversation, Identity, Message, Reservation, Store } from "./types.js";

export function createStore(config: Config, http: SupabaseFetch = fetch): Store {
  const request = createSupabaseClient(config, http);
  const owned = (userId: string, id: string) =>
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`;
  async function conversation(userId: string, id: string) {
    const rows = await request<Conversation[]>(
      `nuelexity_conversations?${owned(userId, id)}&select=id,title,created_at,updated_at,selected_model`,
    );
    if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Conversation not found.");
    return rows[0];
  }
  return {
    async verifyToken(token) {
      if (!config.supabaseUrl || !config.publicKey)
        throw new AppError(503, "AUTH_UNAVAILABLE", "Authentication is not configured.");
      let response: Response;
      try {
        response = await http(`${config.supabaseUrl}/auth/v1/user`, {
          headers: { apikey: config.publicKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new AppError(
          503,
          "AUTH_UNAVAILABLE",
          "Sign-in verification is temporarily unavailable.",
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new AppError(401, "UNAUTHORIZED", "Your session expired. Please sign in again.");
      if (!response.ok)
        throw new AppError(
          503,
          "AUTH_UNAVAILABLE",
          "Sign-in verification is temporarily unavailable.",
        );
      const user = (await response.json()) as { id?: string; is_anonymous?: boolean };
      if (!user.id || user.is_anonymous)
        throw new AppError(401, "UNAUTHORIZED", "Please sign in with Google or GitHub.");
      return user.id;
    },
    list: (userId, offset) =>
      request(
        `nuelexity_conversations?user_id=eq.${encodeURIComponent(userId)}&select=id,title,created_at,updated_at,selected_model&order=updated_at.desc,id.desc&limit=30&offset=${offset}`,
      ),
    async detail(userId, id) {
      const row = await conversation(userId, id);
      const messages = await request<
        (Omit<Message, "followUps" | "answerKind"> & {
          follow_ups: string[];
          answer_kind: Message["answerKind"];
        })[]
      >(
        `nuelexity_messages?conversation_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,role,content,sources,follow_ups,status,created_at,model,answer_kind&order=sequence.asc&limit=60`,
      );
      return {
        conversation: row,
        messages: messages.map(({ follow_ups, answer_kind, ...m }) => ({
          ...m,
          model: m.model ?? null,
          answerKind: answer_kind ?? null,
          followUps: follow_ups,
        })),
      };
    },
    async remove(userId, id) {
      await conversation(userId, id);
      await request(`nuelexity_conversations?${owned(userId, id)}`, { method: "DELETE" });
    },
    async create(userId, query, modelId) {
      const rows = await request<Conversation[]>(
        "nuelexity_conversations?select=id,title,created_at,updated_at,selected_model",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: userId,
            title: query.slice(0, 100),
            selected_model: modelId ?? config.groqModel,
          }),
        },
      );
      return rows[0]!;
    },
    async setModel(userId, id, modelId) {
      await conversation(userId, id);
      await request(`nuelexity_conversations?${owned(userId, id)}&select=id`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ selected_model: modelId, updated_at: new Date().toISOString() }),
      }).then((rows) => {
        if (!Array.isArray(rows) || !rows.length)
          throw new AppError(404, "NOT_FOUND", "Conversation not found.");
      });
    },
    async save(userId, id, message) {
      await conversation(userId, id);
      await request("nuelexity_messages", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          conversation_id: id,
          role: message.role,
          content: message.content,
          sources: message.sources,
          follow_ups: message.followUps,
          status: message.status,
          model: message.model ?? null,
          answer_kind: message.answerKind ?? null,
        }),
      });
    },
    reserve: (identity: Identity, requestId: string) =>
      request<Reservation>("rpc/nuelexity_reserve_request", {
        method: "POST",
        body: JSON.stringify({
          p_subject: identity.subject,
          p_ip_hash: identity.ipHash,
          p_request_id: requestId,
          p_daily_limit: identity.userId ? config.userDaily : config.guestDaily,
          p_ip_limit: config.ipDaily,
          p_global_daily: config.globalDaily,
          p_global_monthly: config.globalMonthly,
          p_global_minute: config.globalMinute,
        }),
      }),
    release: (subject, requestId) =>
      request("rpc/nuelexity_release_request", {
        method: "POST",
        body: JSON.stringify({ p_subject: subject, p_request_id: requestId }),
      }),
    async ready() {
      await request("nuelexity_usage?select=subject&limit=0");
      await request("nuelexity_conversations?select=selected_model&limit=0");
      await request("nuelexity_messages?select=model,answer_kind&limit=0");
    },
  };
}
