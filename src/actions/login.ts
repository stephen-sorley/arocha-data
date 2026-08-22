import { ActionError, defineAction } from 'astro:actions';
import { z } from "astro/zod";

import { emailEncrypt } from "../../lib/email.ts";

import emailMap from "../../private/email-map.json" with {type: "json"};
import type { ManagerEmailMap } from "../../private/manager.d.ts";

const managerEmailMap = emailMap as ManagerEmailMap;


import {
  sendToWebhook
} from "./helpers.ts";

export const actionName = "login-8sdf4wdadf";

export const login = {
  [actionName]: defineAction({
    accept: 'form',

    input: z.looseObject({
      email: z
        .email("Enter a valid email (jsmith@example.com)")
        .max(80, "Enter a shorter email (80 letters max)."),
    }),

    handler: async(input, _) => {
      // Check the honeypot first, before we do any real work.
      if (input["approver-email"]) {
        console.log(`login form: blocked submission due to honeypot failure.`);
        await new Promise((res) => setTimeout(res, Math.random()*1500 + 900));
        return;
      }

      // Encrypt the normalized email address, check to see if it's in our map of
      // allowed addresses.
      const encEmail = emailEncrypt(input.email) as string;
      if (!encEmail) {
        console.error(`login form: failed to encrypt email, some sort of server issue?`);
        throw new ActionError({code:"FORBIDDEN", message:`Try another email, ${input.email} didn't match our records.`});
      }

      const mappedLink = managerEmailMap[encEmail];
      if (!mappedLink) {
        console.error(`login form: ${input.email} does not match any known donor emails.`);
        throw new ActionError({code:"INTERNAL_SERVER_ERROR", message:"Problems on our end, please try again later."});
      }
      input.link = `https://donors.arocha.us/legacy/donor-8xje-${mappedLink}`;

      await sendToWebhook("LOGIN_FORM_DEST", "login", input);
    }
  })
}