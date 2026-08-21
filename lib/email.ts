/**
 * Email normalization and encryption/decryption.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

import crypto from "node:crypto";
import { init, fromEnv } from "./utils.ts";

let EMAIL_KEY: Buffer<ArrayBuffer> | undefined;

const initEmail = () => {
  init();
  if (!EMAIL_KEY) {
    EMAIL_KEY = Buffer.from(fromEnv("EMAIL_KEY"));
  }
}

export const emailNorm = (email?: string) => {
  return email?.trim().toLowerCase();
}

export const emailEncrypt = (email?: string) => {
  initEmail();
  const nemail = emailNorm(email);
  if (!nemail || !EMAIL_KEY) {
    return undefined;
  }
  const enc = crypto.createCipheriv("aes-128-ecb", EMAIL_KEY, null);
  return enc.update(nemail, "utf8", "base64url") + enc.final("base64url");
}

export const emailDecrypt = (encEmail?: string) => {
  initEmail();
  if (!encEmail || !EMAIL_KEY) {
    return undefined;
  }
  const dec = crypto.createDecipheriv("aes-128-ecb", EMAIL_KEY, null)
  return dec.update(encEmail, 'base64url', "utf8") + dec.final("utf8");
}