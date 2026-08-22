/**
 * PayPal
 * 
 * Return all recurring donation subscriptions, in a standard
 * format.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

// Needed because PayPal doesn't store metadata from GiveWP, so we can't determine
// the designations automatically from PayPal data.
import des from "../designation-override.json" with {type: "json"};

import {
  Client,
  Environment,
  SubscriptionsController,
  type ApiResponse,
  type Subscription,
  type SubscriptionCollection
} from '@paypal/paypal-server-sdk';

import {
  init,
  fromEnv,
  statusFromString,
  type RecurringSub,
  type RecurringStatus
} from "./utils.ts";

import {
  emailNorm,
} from "./email.ts";


export type PaypalConnection = SubscriptionsController;

export const paypalConnect = (): PaypalConnection => {
  init();

  return new SubscriptionsController(new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: fromEnv("PAYPAL_ID"),
      oAuthClientSecret: fromEnv("PAYPAL_KEY"),
    },
    timeout: 0,
    environment: Environment.Production,
  }));
}

export const paypalGetStatus = async (pp: PaypalConnection, id: string): Promise<RecurringStatus> => {

  return pp.getSubscription({id: id}).then((sub) => (
    statusFromString(JSON.parse(sub.body as string)?.status)
  ));
}

export const paypalFindSubs = async (pp: PaypalConnection, ids: string[]) => {
  const subs: any[] = [];

  return Promise.all(ids.map(id => 
    pp.getSubscription({id: id, fields: "plan"}).then(sub => {
      subs.push(JSON.parse(sub.body as string));
    })
  )).then(() => subs);
}

export const paypalNormalizeSub = (sub: Subscription): RecurringSub | undefined => {
  const plan = sub.plan?.billingCycles?.[0];
  if (!sub.id || !sub.startTime || !plan) {
    return undefined;
  }

  let freq: RecurringSub["frequency"] | undefined;
  const unit = plan.frequency.intervalUnit.toLocaleLowerCase();
  const count = plan.frequency.intervalCount;
  if (unit === "month") {
    if (count === 1) {
      freq = "month";
    } else if (count === 3) {
      freq = "quarter";
    } else if (count === 12) {
      freq = "year";
    }
  } else if (unit === "year" && count === 1) {
    freq = "year";
  }
  if (!freq) {
    throw new Error(`${sub.id}: unknown frequency (${count}, ${unit})`);
  }

  return {
    id: sub.id,
    since: sub.startTime,
    lead: "GiveWP",
    email: emailNorm(sub.subscriber?.emailAddress),
    designation: (des as any)[sub.id] ?? "UNKNOWN",
    firstName: sub.subscriber?.name?.givenName,
    lastName: sub.subscriber?.name?.surname,
    amount: Number(plan.pricingScheme?.fixedPrice?.value),
    frequency: freq,
  };
};

export type PaypalListSubsParams = {
  statuses?: ("APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED")[],
  fields?: ("plan" | "last_failed_payment")[],
};
export const paypalListSubs = async (pp: PaypalConnection, params?: PaypalListSubsParams) => {
  const CHUNK = 20;

  params ??= {};
  params.statuses ??= ["ACTIVE"];
  params.fields ??= ["plan"];

  const statusStr = params.statuses.length? params.statuses.join(",") : undefined;
  const fieldsStr = params.fields.length? params.fields.join(",") : undefined;

  const subIds: NonNullable<ApiResponse<SubscriptionCollection>["result"]["subscriptions"]> = [];
  let page = 1;
  while (true) {
    const resp = (await pp.listSubscriptions({
      pageSize: CHUNK,
      page: page,
      statuses: statusStr,
    })).result.subscriptions;

    if (resp) {
      subIds.push(...resp);
    }
    if (!resp || resp.length < CHUNK) {
      break;
    }
  }

  const subs: Subscription[] = [];

  for (let i=0; i<subIds?.length; i+=CHUNK) {
    await Promise.all(subIds.slice(i, i+CHUNK).map(({id}) => {
      if (id) {
        return pp.getSubscription({id: id, fields: fieldsStr}).then(({result: sub}) => {
          subs.push(sub);
        });
      }
    }));
  }

  return subs;
}