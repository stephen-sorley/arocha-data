/**
 * Utilities for actions and pages to perform various activivites involving
 * checking and updating data for the Legacy Subscription Manager.
 * 
 * Collected it all in one place to avoid having to duplicate a bunch
 * of complicated imports.
 */

import {
  stripeConnect,
  stripeGetStatus,
  type StripeConnection,
} from "../lib/stripe.ts";

import {
  paypalConnect,
  paypalGetStatus,
  type PaypalConnection,
} from "../lib/paypal.ts";

import type {
  RecurringStatus
} from "../lib/utils.ts";

// Import static private JSON data, force the proper types using "as".
import emailMap_gen from "../private/email-map.json" with {type: "json"};
import subInfo_gen from "../private/recurring.json" with {type: "json"};
import type {
  ManagerEmailMap,
  ManagerSubInfo
} from "../private/manager.d.ts";
import { ActionError } from "astro:actions";
const managerEmailMap = emailMap_gen as ManagerEmailMap;
const managerSubInfo = subInfo_gen as ManagerSubInfo;

export type SubInfo = ManagerSubInfo["key: string"];

let stripe: StripeConnection | undefined;
let paypal: PaypalConnection | undefined;

const initConnections = (subInfo: SubInfo) => {
  stripe ??= subInfo.hasStripe? stripeConnect() : undefined;
  paypal ??= subInfo.hasPaypal? paypalConnect() : undefined;
}

const errToString = (e: Error | any) => {
  return (e instanceof Error? `${e.message}\n\n${e.stack}` : e);
}

export const getSubInfo = (token?: string) => {
  if (!token) {
    return {error: "token missing"};
  }
  const account = managerEmailMap[token];
  if (!account) {
    return {error: `token ${token} not found`};
  }
  const subInfo = managerSubInfo[account];
  if (!subInfo) {
    return {error: `account ${account} not found`};
  }
  return {subInfo: subInfo};
}

export const getStatuses = async (subInfo: SubInfo): Promise<RecurringStatus[]> => {
  initConnections(subInfo);

  return Promise.all(subInfo.subs.map(sub => {
    try {
      if (sub.processor === "stripe") {
        return stripeGetStatus(stripe as NonNullable<typeof stripe>, sub.processorId);
      }
      if (sub.processor === "paypal") {
        return paypalGetStatus(paypal as NonNullable<typeof paypal>, sub.processorId);
      }
    } catch(e) {
      console.error(`Error getting status for ${sub.processorId}: ` + errToString(e));
    }
    return "unknown";
  }));
}

export type CancelSubParams = {
  index: number,
  proc: "stripe" | "paypal",
  procid: string,
}
export const cancelSub = async (subInfo: SubInfo, params: CancelSubParams) => {
  initConnections(subInfo);

  // Make sure the processor ID we're requesting to cancel is actually owned by
  // this account.
  const sub = subInfo.subs[params.index];
  if (sub?.processorId !== params.procid) {
    throw new ActionError({
      message: `given processor ID ${params.procid} doesn't match ${sub?.processorId}`,
      code: "BAD_REQUEST",
    });
  }
  if (sub?.processor !== params.proc) {
    throw new ActionError({
      message: `given processor ${params.proc} doesn't match ${sub?.processor}`,
      code: "BAD_REQUEST",
    });
  }

  try {
    const reason = "canceled online using Legacy Subscription Manager";
    if (params.proc === "stripe") {
      await (stripe as StripeConnection).subscriptions.cancel(params.procid, {cancellation_details: {comment: reason}});
    } else {
      await (paypal as PaypalConnection).cancelSubscription({id: params.procid, body: {reason: reason}});
    }
  } catch (e) {
    throw new ActionError({
      message: `${params.proc} request failed: ${errToString(e)}`,
      code: "SERVICE_UNAVAILABLE",
    });
  }
}