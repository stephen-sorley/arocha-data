#!/usr/bin/env node

// Retrieve data from stripe and/or paypal for the list of ID's passed on the
// command line.

import { parseArgs } from "node:util";
import {
  stripeConnect,
  stripeFindSubs,
  stripeNormalizeSub,
} from "./lib/stripe.ts";

import {
  paypalConnect,
  paypalFindSubs,
  paypalNormalizeSub
} from "./lib/paypal.ts";

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    verbose: {type: "boolean", short: "v"},
  }
});

const stripeIds = positionals.filter(id => id.startsWith("sub_"));
const paypalIds = positionals.filter(id => id.startsWith("I-"));

const stripe = stripeIds? stripeConnect() : undefined;
const paypal = paypalIds? paypalConnect() : undefined;

const subs: any[] = [];

const start = performance.now();
if (stripe) {
  subs.push(... await stripeFindSubs(stripe, stripeIds).then(subs => {
    if (!values.verbose) {
      return subs.map(sub => stripeNormalizeSub(sub));
    }
    return subs;
  }));
}
if (paypal) {
  subs.push(... await paypalFindSubs(paypal, paypalIds).then(subs => {
    if (!values.verbose) {
      return subs.map(sub => paypalNormalizeSub(sub));
    }
    return subs;
  }));
}
console.error(`\nRetrieved ${subs.length} subscriptions in ${(performance.now() - start)/1000}s`);

console.log(JSON.stringify(subs, null, 2));