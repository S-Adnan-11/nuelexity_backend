import { copyFile, constants } from "node:fs/promises";
try {
  await copyFile(".env.example", ".env", constants.COPYFILE_EXCL);
  console.log("Created .env from .env.example. Fill in your own service settings.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Kept existing .env unchanged.");
}
