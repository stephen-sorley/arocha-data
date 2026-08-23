import { login } from "./login.ts";
import { cancel } from "./cancel.ts";

export const server: Record<string, any> = {
  ...login,
  ...cancel
}