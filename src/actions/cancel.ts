import { ActionError, defineAction } from 'astro:actions';
import { z } from "astro/zod";

import { cancelSub, getSubInfo } from "../manager.ts";

export const actionName = "cancel-ck57pO5s";

export const cancel = {
  [actionName]: defineAction({
    accept: "form",

    input: z.looseObject({
      index: z.int().gte(0).lt(20),
      procid: z.string().max(60).regex(/^(sub_|I-)/)
    }),

    handler: async(input, ctx) => {
      const token = ctx.params.token;

      const {error: authError, subInfo} = getSubInfo(token);

      if (authError !== undefined) {
        console.error("error authenticating: " + authError);
        throw new ActionError({message: "authentication failure", code: "FORBIDDEN"});
      }

      await cancelSub(subInfo, input);

      return input.procid;
    }
  })
}