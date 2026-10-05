import { createApp } from "./app";
import { readConfig } from "./lib/config";

export const app = createApp();

    //non-conceptual dummy----> endpoint
app.post("/requestlity_nuelexity", async (req, res) => {
    
    // SSE setup
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.flushHeaders();

    const dummy = req.body.dummy;

    res.write(`data: Starting...\n\n`);

    res.write(`data: ${dummy}\n\n`);

    res.write(`data: Why is this not a way to run the same request for _ask\n\n`);

    res.write(`data: Finished!\n\n`);

    res.end();

    res.end();
});

if (import.meta.main) {
  const config = readConfig();
  const server = app.listen(config.port, () => console.log(`Nuelexity backend running on port ${config.port}`));
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
