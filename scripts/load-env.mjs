import { loadEnvFile } from "node:process";

// Explicit environment wins. Match the existing .env.local > mode > .env order.
export function loadEnvironment(mode = process.env.NODE_ENV || "development") {
  for (const file of [".env.local", `.env.${mode}`, ".env"]) {
    try { loadEnvFile(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
