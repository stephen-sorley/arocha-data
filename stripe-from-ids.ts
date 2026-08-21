#!/usr/bin/env node

// Retrieve data from stripe for the list of ID's passed on the command line.

import type Stripe from "stripe";
import { parseArgs } from "node:util";
import { stripeConnect, stripeGetSubs } from "./lib/stripe.ts";

const {positionals} = parseArgs({
  allowPositionals: true,
});

const stripe = stripeConnect();

let start = performance.now();
const subs = await stripeGetSubs(stripe, positionals, {
  expand: ["customer", "items.data.price.product"],
});
console.error(`\nRetrieved ${subs.length} subscriptions in ${(performance.now() - start)/1000}s`);

let i=0;
for (const sub of subs) {
  i++;

  console.log(`${sub.id}: ${i} of ${subs.length}
    Product name: ${(sub.items.data[0].price.product as Stripe.Product)?.name}
    Designate to: ${sub.metadata?.["Designate to"]}
    Designated to: ${sub.metadata?.["Designated to"]}
    International Projects: ${sub.metadata?.["International Projects"]}
    US Projects: ${sub.metadata?.["US Projects"]}
    Other Designation: ${sub.metadata?.["Other Designation"]}
    Notes: ${sub.metadata?.["Notes"]}
` );
}