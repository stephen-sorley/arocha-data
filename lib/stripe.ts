/**
 * Stripe
 * 
 * https://github.com/stripe/stripe-node
 * 
 * Return all recurring donation subscriptions in a standard format, among
 * other things.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

import { setTimeout } from 'node:timers/promises';

import des from "../designation-override.json" with {type: "json"};

import Stripe from "stripe";

import {
  init,
  fromEnv,
  statusFromString,
  type RecurringSub,
} from "./utils.ts";

import { emailNorm } from "./email.ts";


// Helper function to determine the gift designation, using the metadata scattered
// around inside the Stripe record.
const getDesignation = (sub: Stripe.Subscription) => {
  // Allow manually-specified overrides for any subscriptions in Stripe that got
  // the wrong designation when originally created.
  const override = (des as Record<string,string>)[sub.id];
  if (override) {
    return override;
  }

  const maybeProduct = (sub as any).plan?.product as string | null | undefined | Stripe.Product;
  const product = (maybeProduct && typeof maybeProduct === "object")? maybeProduct : undefined;

  const meta = sub.metadata;

  const toCheck = [
    product?.name,
    meta?.["Designate to"],
    meta?.["Designated to"],
    meta?.["International Projects"],
    meta?.["US Projects"],
    meta?.["Other Designation"],
  ];

  const checkAll = (name: string) => toCheck.some(des => {
    return des && des.toLocaleLowerCase().includes(name.toLocaleLowerCase());
  });

  /*
    Do string matching across the various metadata fields that GiveWP sets in
    order to figure out the designation.

    If the string on the left is found anywhere in the metadata fields, the
    designation will be set to the string on the right.

    This searches within strings (it doesn't have to match the full field), and
    it is not case-sensitive.

    List of campaign names in Salesforce:
    https://arochausa.lightning.force.com/lightning/o/Campaign/list?filterName=AllActiveCampaigns
   */
  const searchToDesignation = [
    ["Brown",     "USA-(Brown)"],
    ["Chuang",    "USA-(Chuang)"],
    ["Guthrie",   "USA-(Guthrie)"],
    ["Henderson", "USA-(Henderson)"],
    ["Huska",     "USA-(Huska)"],
    ["Lamb",      "USA-(Lamb)"],
    ["Michalski", "USA-(Michalski)"],
    ["Sluka",     "USA-(Sluka)"],
    ["Walton",    "USA-(Walton)"],

    ["Anderson", "Canada-Anderson"],
    ["Faw",      "Canada-Faw"],
    ["Kostamo",  "Canada-Kostamo"],
    ["Richmond", "Canada-Richmond"],

    ["Social Media and Content Coordinator", "Social Media and Content Coordinator (Autumn Ayers)"],
    
    ["Church Engagement",              "USA-Church Engagement"],
    ["Conservation Internships",       "USA-Conservation Interns"],
    ["Florida Conservation Project",   "USA-Florida Conservation Project"],
    ["Tennessee Conservation Project", "USA-Tennessee Conservation Project"],
    ["Texas Conservation Project",     "USA-Texas Conservation Project"],
    
    ["Climate Stewards",         "Climate Stewards"],
    ["Global Conservation Fund", "Global Conservation Fund(GCF)-ARI"],
    
    ["Costa Rica",    "Casa Adobe/Costa Rica"],
    ["Canada",        "Canada"],
    ["Kenya",         "Kenya"],
    ["International", "ARI"],
  ];

  for (const [searchStr, designation] of searchToDesignation) {
    if (checkAll(searchStr)) {
      return designation;
    }
  }

  // If we couldn't find anything, return the USA general fund designation.
  return "USA";
}


export type StripeConnection = ReturnType<typeof stripeConnect>;

export const stripeConnect = () => {
  // API keys here: https://dashboard.stripe.com/acct_1EwwrmKnX7EKttkA/apikeys
  init();

  return new Stripe(fromEnv("STRIPE_KEY"), {
    telemetry: false,
    timeout: 10 * 1000,
    maxNetworkRetries: 2,
  });
}

export const stripeGetStatus = async (stripe: StripeConnection, id: string) => {
  return stripe.subscriptions.retrieve(id).then((sub) => statusFromString(sub.status));
}

export const stripeFindSubs = async (stripe: StripeConnection, ids: string[], params?: Stripe.SubscriptionRetrieveParams) => {
  const CHUNK = 12;
  
  params ??= {};
  params.expand ??= [
    "customer",
    "plan.product"
  ];
  
  const subs: Stripe.Subscription[] = [];

  for (let i=0; i<ids.length; i+=CHUNK) {
    if (i > 0) {
      await setTimeout(100);
    }
    const temp = await(Promise.all(ids.slice(i,i+CHUNK).map(id =>
      stripe.subscriptions.retrieve(id, params)
    )));
    subs.push(...temp);
  }

  return subs;
};

export const stripeNormalizeSub = (sub: Stripe.Subscription) : RecurringSub => {
  const customer = sub.customer as Stripe.Customer;
  const plan = (sub as any).plan as Stripe.Plan;

  let frequency: RecurringSub["frequency"] | undefined;
  if (plan.interval === "month") {
    if (plan.interval_count === 1) {
      frequency = "month";
    } else if (plan.interval_count === 3) {
      frequency = "quarter";
    }
  } else if (plan.interval === "year" && plan.interval_count === 1) {
    frequency = "year";
  }
  if (!frequency) {
    throw new Error(`${sub.id}: unsupported recurring frequency: every ${plan.interval_count} ${plan.interval}`);
  }
  
  let firstName = customer.metadata?.first_name?.trim() || customer.name?.split(" ")[0];
  let lastName = customer.metadata?.last_name?.trim() || customer.name?.split(" ").slice(1).join(" ");

  if (!customer.email) {
    throw new Error(`${sub.id}: missing customer email`);
  }

  return {
    id: sub.id,
    since: new Date(sub.created*1000).toISOString(),
    lead: customer.description?.toLocaleLowerCase().includes("givewp")? "GiveWP" : "LYP",
    email: emailNorm(customer.email),
    designation: getDesignation(sub),
    firstName: firstName,
    lastName: lastName,
    amount: (plan.amount ?? NaN) / 100,
    frequency: frequency,
  }
}

export const stripeListSubs = async (stripe: StripeConnection, params?: Stripe.SubscriptionListParams) => {
  params ??= {};
  params.status ??= 'active';
  params.limit ??= 100;
  params.expand ??= [
    "data.customer",
    "data.plan.product",
  ];

  const subs: Stripe.Subscription[] = [];
  for await (const sub of stripe.subscriptions.list(params)) {
    subs.push(sub);
  }
  return subs;
}
