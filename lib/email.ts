/**
 * Email normalization and encryption/decryption.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

import crypto from "node:crypto";
import { init, fromEnv } from "./utils.ts";

let EMAIL_KEY: string | undefined;

const initEmail = () => {
  init();
  if (!EMAIL_KEY) {
    EMAIL_KEY = fromEnv("EMAIL_KEY");
  }
}

export const emailNorm = (email?: string) => {
  return email?.trim().toLowerCase();
}

export const emailHash = (email?: string) => {
  initEmail();
  const nemail = emailNorm(email);
  if (!nemail || !EMAIL_KEY) {
    return undefined;
  }
  return crypto
    .createHmac('sha256', EMAIL_KEY)
    .update(nemail)
    .digest('base64url'); // Outputs a fixed 64-character hex string
}
