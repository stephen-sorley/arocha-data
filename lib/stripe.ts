/**
 * Stripe
 * 
 * Return all recurring donation subscriptions, in a standard
 * format.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

import { setTimeout } from 'node:timers/promises';

import des from "../designation-override.json" with {type: "json"};

import Stripe from "stripe";

import {
  init,
  fromEnv,
  type RecurringSub
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

  const prodName = (sub.items.data[0].price.product as Stripe.Product)?.name;
  const desTo = sub.metadata?.["Designate to"] || sub.metadata?.["Designated to"];
  const intlProj = sub.metadata?.["International Projects"];
  const usProj = sub.metadata?.["US Projects"];
  const other = sub.metadata?.["Other Designation"];
  const all = [prodName, desTo, intlProj, usProj, other];

  const checkAll = (name: string) => all.some(des => {
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
  });
}

export const stripeGetSubs = async (stripe: StripeConnection, ids: string[], params?: Stripe.SubscriptionRetrieveParams) => {
  const CHUNK = 12;
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

export const stripeCondenseSub = (sub: Stripe.Subscription) : RecurringSub => {
  const customer = sub.customer as Stripe.Customer;
  const plan = sub.items.data[0].plan;

  let frequency: RecurringSub["frequency"] | undefined;
  if (plan.interval === "month") {
    if (plan.interval_count === 1) {
      frequency = "Month";
    } else if (plan.interval_count === 3) {
      frequency = "Quarter";
    }
  } else if (plan.interval === "year" && plan.interval_count === 1) {
    frequency = "Year";
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
    since: Temporal.Instant.fromEpochMilliseconds(sub.created*1000).toString(),
    lead: customer.description?.toLocaleLowerCase().includes("givewp")? "GiveWP" : "LYP",
    email: emailNorm(customer.email),
    designation: getDesignation(sub),
    firstName: firstName,
    lastName: lastName,
    amount: (plan.amount ?? NaN) / 100,
    frequency: frequency,
  }
}