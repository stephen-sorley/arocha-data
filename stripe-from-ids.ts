#!/usr/bin/env node

// Retrieve data from stripe for the list of ID's passed on the command line.

import { parseArgs } from "node:util";
import {
  stripeConnect,
  stripeGetSubs,
  stripeCondenseSub,
} from "./lib/stripe.ts";

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    verbose: {type: "boolean", short: "v"},
  }
});

const stripe = stripeConnect();

let start = performance.now();
const subs = await stripeGetSubs(stripe, positionals);
console.error(`\nRetrieved ${subs.length} subscriptions in ${(performance.now() - start)/1000}s`);

if (values.verbose) {
  console.log(JSON.stringify(subs, null, 2));
} else {
  const condensed = subs.map(sub => stripeCondenseSub(sub));
  console.log(JSON.stringify(condensed, null, 2));
}