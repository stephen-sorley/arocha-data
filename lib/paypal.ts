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
  SubscriptionsController
} from '@paypal/paypal-server-sdk';

import {
  init,
  fromEnv,
  type RecurringSub
} from "./utils.ts";


export type PaypalConnection = ReturnType<typeof paypalConnect>;

export const paypalConnect = () => {
  init();

  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: fromEnv("PAYPAL_ID"),
      oAuthClientSecret: fromEnv("PAYPAL_KEY"),
    },
    timeout: 0,
    environment: Environment.Production,
  });
}

export const paypalCondensedSubs = async (pp: PaypalConnection) => {
  const pps = new SubscriptionsController(pp);
  const CHUNK = 20;

  const subIds: NonNullable<Awaited<ReturnType<typeof pps.listSubscriptions>>["result"]["subscriptions"]> = [];
  let page = 1;
  while (true) {
    const resp = (await pps.listSubscriptions({
      pageSize: CHUNK,
      page: page,
      statuses: "ACTIVE"
    })).result.subscriptions;

    if (resp) {
      subIds.push(...resp);
    }
    if (!resp || resp.length < CHUNK) {
      break;
    }
  }

  const subs: RecurringSub[] = [];

  for (let i=0; i<subIds?.length; i+=CHUNK) {
    await Promise.all(subIds.slice(i, i+CHUNK).map(({id}) => {
      if (id) {
        return pps.getSubscription({id: id, fields: "plan,product"}).then(({result: sub}) => {
          const plan = sub.plan?.billingCycles?.[0];
          if (!sub.id || !sub.startTime || !plan) {
            return;
          }

          let freq: "Month" | "Quarter" | "Year" | undefined;
          const unit = plan.frequency.intervalUnit.toLocaleUpperCase();
          const count = plan.frequency.intervalCount;
          if (unit === "MONTH") {
            if (count === 1) {
              freq = "Month";
            } else if (count === 3) {
              freq = "Quarter";
            } else if (count === 12) {
              freq = "Year";
            }
          } else if (unit === "YEAR" && count === 1) {
            freq = "Year";
          }
          if (!freq) {
            throw new Error(`${sub.id}: unknown frequency (${count}, ${unit})`);
          }

          subs.push({
            id: sub.id,
            since: sub.startTime,
            lead: "GiveWP",
            email: sub.subscriber?.emailAddress,
            designation: (des as any)[sub.id] ?? "UNKNOWN",
            firstName: sub.subscriber?.name?.givenName,
            lastName: sub.subscriber?.name?.surname,
            amount: Number(plan.pricingScheme?.fixedPrice?.value),
            frequency: freq,
          });
        });
      }
    }));
  }

  return subs;
}