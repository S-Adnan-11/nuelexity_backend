import { loadEnvironment } from "./load-env.mjs";
if (process.env.NUELEXITY_ENV_FILE !== "none") loadEnvironment();
