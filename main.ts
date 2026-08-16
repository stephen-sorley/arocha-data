#!/usr/bin/env node

import type Stripe from "stripe";

import {
  stripeConnect,
  stripeGetSubs,

  sfConnect,
  sfEmailsToContacts
} from "./lib/utils.ts";

import records from "./not-cnp.json" with { type: 'json' };
import { exit } from "node:process";


const stripe = stripeConnect();
const sf = await sfConnect();

// Get subscription data from Stripe.
const ids = records.map(record => record["Processor Subscription ID"]).filter(id => id.startsWith("sub_"));
let start = performance.now();
const subs = await stripeGetSubs(stripe, ids, {
  expand: ["customer", "items.data.price.product"],
});
console.error(`\nRetrieved ${subs.length} subscriptions in ${(performance.now() - start)/1000}s`);

// Sort in descending order (newest first).
subs.sort((a,b) => b.start_date - a.start_date);

// Extract email addresses.
const emails = subs.map( sub => (sub.customer as Stripe.Customer).email?.toLocaleLowerCase() || "" );

start = performance.now();
const contacts = await sfEmailsToContacts(sf, emails);
console.error(`\nConverted ${contacts.length} emails to contacts in ${(performance.now() - start)/1000}s`);

for (const email of emails) {
  console.log(email);
}
