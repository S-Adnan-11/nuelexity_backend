import express from "express";
import type { ErrorRequestHandler, Request, Response } from "express";
import cors from "cors";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate } from "./middleware";
import { followUps } from "./prompts";
import { readConfig } from "./lib/config";
import type { Config } from "./lib/config";
import { AppError, publicError } from "./lib/errors";
import { createProviders } from "./lib/providers";
import { createStore } from "./lib/store";
import { issueGuestSession, verifyGuestSession } from "./lib/guest-session";
import type { Message, Providers, Source, Store } from "./lib/types";

const askSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    conversationId: z.uuid().optional(),
    turnstileToken: z.string().max(2048).optional(),
    history: z
      .array(
        z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) }).strict(),
      )
      .max(6)
      .optional(),
  })
  .strict();
const uuid = (value: unknown) => {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new AppError(400, "INVALID_ID", "Use a valid conversation ID.");
  return result.data;
};
export function createApp(options: { config?: Config; store?: Store; providers?: Providers } = {}) {
  const config = options.config || readConfig();
  const store = options.store || createStore(config);
  const providers = options.providers || createProviders(config);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops || false);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin))
      return next(new AppError(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed."));
    next();
  });
  app.use(
    cors({
      origin: config.origins,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Guest-Pass"],
      exposedHeaders: ["Retry-After"],
    }),
  );
  app.use(express.json({ limit: "16kb", strict: true }));

  // A bounded, cheap IP throttle also protects auth/database/bot verification.
  // Provider budgets live in Postgres; this guard resetting cannot reset those.
  const bursts = new Map<string, { count: number; until: number }>();
  app.use((req, _res, next) => {
    const now = Date.now();
    if (bursts.size >= 10000)
      for (const [key, value] of bursts) if (value.until < now) bursts.delete(key);
    const key = req.ip || "unknown";
    let entry = bursts.get(key);
    if (!entry || entry.until < now) {
      if (!entry && bursts.size >= 10000)
        return next(new AppError(429, "BUSY", "Server is busy. Try again shortly.", 60));
      entry = { count: 0, until: now + 60000 };
      bursts.set(key, entry);
    }
    if (++entry.count > 60)
      return next(new AppError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", 60));
    next();
  });

  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      searchConfigured: config.configured,
      guestsEnabled: config.guestsEnabled,
      answerMode: config.aiProvider === "none" ? "sources-only" : "ai",
    }),
  );
  app.get("/ready", async (_req, res) => {
    if (!config.configured)
      throw new AppError(503, "NOT_CONFIGURED", "Search configuration is incomplete.");
    await store.ready();
    res.json({ status: "ready" });
  });
  const guestIpHash = (req: Request) =>
    createHmac("sha256", config.guestSecret)
      .update(req.ip || req.socket.remoteAddress || "unknown")
      .digest("hex");
  const guestPass = (req: Request) =>
    verifyGuestSession(config.guestSecret, req.get("X-Guest-Pass") || "", guestIpHash(req));
  const checkGuestSetup = () => {
    if (!config.configured)
      throw new AppError(503, "NOT_CONFIGURED", "Guest search setup is incomplete.");
    if (!config.guestsEnabled)
      throw new AppError(503, "GUESTS_UNAVAILABLE", "Guest search is not enabled yet. Please sign in.");
  };
  app.get("/guest/session", (req, res) => {
    checkGuestSetup();
    const session = guestPass(req);
    res.json({
      verified: !!session,
      verificationRequired: !!config.turnstileSecret || config.production,
      guestId: session?.guestId || null,
      expiresAt: session?.expiresAt || null,
    });
  });
  app.post("/guest/session", async (req, res) => {
    checkGuestSetup();
    if (!config.turnstileSecret)
      throw new AppError(503, "BOT_CHECK_UNAVAILABLE", "Guest verification is not enabled here.");
    const input = z
      .object({ turnstileToken: z.string().min(1).max(2048) })
      .strict()
      .safeParse(req.body);
    if (!input.success)
      throw new AppError(400, "BOT_CHECK_REQUIRED", "Complete the verification before searching.");
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    try {
      await providers.verifyGuest(
        input.data.turnstileToken,
        req.ip || req.socket.remoteAddress || "unknown",
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      );
      controller.signal.throwIfAborted();
      res.json(issueGuestSession(config.guestSecret, guestIpHash(req)));
    } finally {
      res.off("close", onClose);
    }
  });
  app.get(["/conversation", "/conversations"], async (req, res) => {
    const userId = (await authenticate(req, store, true))!;
    const parsed = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .safeParse(req.query.offset || 0);
    if (!parsed.success) throw new AppError(400, "INVALID_OFFSET", "Use a valid history offset.");
    res.json({ conversations: await store.list(userId, parsed.data) });
  });
  app.get("/conversations/:id", async (req, res) => {
    const userId = (await authenticate(req, store, true))!;
    res.json(await store.detail(userId, uuid(req.params.id)));
  });
  app.delete("/conversations/:id", async (req, res) => {
    const userId = (await authenticate(req, store, true))!;
    await store.remove(userId, uuid(req.params.id));
    res.status(204).end();
  });
  app.post(["/signup", "/login"], (_req, res) =>
    res
      .status(410)
      .json({
        error: { code: "USE_OAUTH", message: "Use Google or GitHub through Supabase Auth." },
      }),
  );

  async function ask(req: Request, res: Response) {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_REQUEST",
        "Send a question of 1–1000 characters with valid conversation context.",
      );
    if (!config.configured)
      throw new AppError(
        503,
        "NOT_CONFIGURED",
        "Search setup is incomplete. The project owner needs to finish server configuration.",
      );
    const userId = await authenticate(req, store);
    const input = parsed.data;
    if (!userId && input.conversationId)
      throw new AppError(401, "UNAUTHORIZED", "Sign in to continue a saved conversation.");
    if (userId && input.history)
      throw new AppError(
        400,
        "INVALID_CONTEXT",
        "Saved conversation context is loaded by the server.",
      );
    if (req.path.endsWith("/follow_up") && !input.conversationId && !input.history?.length)
      throw new AppError(
        400,
        "CONTEXT_REQUIRED",
        "Provide an existing conversation for follow-ups.",
      );

    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new AppError(504, "TIMEOUT", "This search took too long. Try a narrower question."),
        ),
      config.requestTimeoutMs,
    );
    const onClose = () => {
      if (!res.writableEnded) controller.abort(new AppError(499, "CANCELLED", "Search stopped."));
    };
    res.on("close", onClose);
    const signal = controller.signal;
    const requestId = randomUUID();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    // Raw IPs aren't persisted, and a stable secret prevents identity resets.
    const ipHash = createHmac("sha256", config.guestSecret).update(ip).digest("hex");
    const identity = { subject: userId ? `user:${userId}` : `guest:${ipHash}`, ipHash, userId };
    let reserved = false,
      conversationId = input.conversationId || null;
    let answer = "",
      sources: Source[] = [],
      savedUser = false,
      savedAssistant = false;
    const send = (event: string, data: unknown) => {
      signal.throwIfAborted();
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!userId) {
        checkGuestSetup();
        if (req.get("X-Guest-Pass")) {
          if (!guestPass(req))
            throw new AppError(
              403,
              "BOT_SESSION_EXPIRED",
              "Your guest verification expired. Please verify again.",
            );
        } else await providers.verifyGuest(input.turnstileToken || "", ip, signal);
      }
      let history: Message[] = [];
      if (userId && conversationId) {
        history = (await store.detail(userId, conversationId)).messages;
        if (history.length >= 60)
          throw new AppError(409, "THREAD_LIMIT", "This thread is full. Start a new search.");
      } else if (!userId)
        history = (input.history || []).map((m) => ({
          ...m,
          id: "",
          sources: [],
          followUps: [],
          status: "complete",
          created_at: "",
        }));
      signal.throwIfAborted();
      const reservation = await store.reserve(identity, requestId);
      if (!reservation.allowed)
        throw new AppError(
          429,
          reservation.code || "QUOTA_EXCEEDED",
          "Search limit reached. Please wait before trying again.",
          reservation.retryAfter || 60,
        );
      reserved = true;
      signal.throwIfAborted();
      // Re-read after acquiring the lease, so an earlier turn can't leave stale context.
      if (userId && conversationId) {
        history = (await store.detail(userId, conversationId)).messages;
        if (history.length >= 60)
          throw new AppError(409, "THREAD_LIMIT", "This thread is full. Start a new search.");
      }
      if (userId && !conversationId) conversationId = (await store.create(userId, input.query)).id;
      if (userId && conversationId) {
        await store.save(userId, conversationId, {
          role: "user",
          content: input.query,
          sources: [],
          followUps: [],
          status: "complete",
        });
        savedUser = true;
      }
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      send("meta", {
        requestId,
        conversationId,
        answerMode: config.aiProvider === "none" ? "sources-only" : "ai",
        remaining: reservation.remaining,
      });
      send("status", { stage: "searching" });
      heartbeat = setInterval(() => {
        if (!res.destroyed && !signal.aborted) res.write(": keep-alive\n\n");
      }, 10000);
      // Short follow-ups get the last user question as extra retrieval context.
      const lastQuestion = [...history].reverse().find((m) => m.role === "user")?.content;
      const retrievalQuery = lastQuestion
        ? `${lastQuestion.slice(0, 400)}\nFollow-up: ${input.query}`.slice(0, 1000)
        : input.query;
      sources = await providers.search(retrievalQuery, signal);
      send("sources", { sources });
      send("status", { stage: "answering" });
      for await (const text of providers.answer(input.query, sources, history, signal)) {
        if (answer.length + text.length > 12000)
          throw new AppError(
            502,
            "ANSWER_LIMIT",
            "Pardon we're still underr development and we set some limitations\n This answer is too long. Try a narrower question.",
          );
        answer += text;
        send("delta", { text });
      }
      if (!answer.trim())
        throw new AppError(
          502,
          "EMPTY_ANSWER",
          "No answer was returned. Your sources are still available.",
        );
      signal.throwIfAborted();
      const suggestions = followUps(input.query);
      if (userId && conversationId) {
        await store.save(userId, conversationId, {
          role: "assistant",
          content: answer,
          sources,
          followUps: suggestions,
          status: "complete",
        });
        savedAssistant = true;
      }
      send("follow_ups", { questions: suggestions });
      send("done", { conversationId });
      res.end();
    } catch (error) {
      const failure = publicError(signal.aborted ? signal.reason : error);
      if (savedUser && !savedAssistant && userId && conversationId) {
        await store
          .save(userId, conversationId, {
            role: "assistant",
            content: answer || failure.message,
            sources,
            followUps: [],
            status: "failed",
          })
          .catch(() => {});
      }
      if (!res.headersSent) throw failure;
      if (!res.destroyed) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: failure.code, message: failure.message })}\n\n`,
        );
        res.end();
      }
    } finally {
      clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
      res.off("close", onClose);
      if (reserved) await store.release(identity.subject, requestId).catch(() => {});
    }
  }
  app.post(["/nuelexity_ask", "/nuelexity_ask/follow_up"], ask);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const failure =
      error?.type === "entity.too.large"
        ? new AppError(413, "BODY_TOO_LARGE", "The request body is too large.")
        : error?.type === "entity.parse.failed"
          ? new AppError(400, "INVALID_JSON", "Send valid JSON.")
          : publicError(error);
    if (failure.retryAfter) res.setHeader("Retry-After", String(failure.retryAfter));
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message } });
  };
  app.use(errors);
  return app;
}
