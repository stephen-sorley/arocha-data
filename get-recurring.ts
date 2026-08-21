#!/usr/bin/env -S node --harmony-temporal

/**
 * get-recurring.ts
 * 
 * Outputs all current recurring subscriptions in JSON and CSV formats:
 *   private/recurring.csv
 *   private/recurring.json
 *   private/email-map.json
 * 
 * Email addresses are encrypted using EMAIL_KEY before storage, so they can
 * be used in links handed out to donors.
 * 
 * Email map maps all of each contact's emails to the primary email used as a key.
 * (all emails in the map are encrypted too).
 * 
 * Since Click and Pledge doesn't provide an API that we can pull from, have to
 * handle those by importing "cnp.json", which we made by hand.
 */

import { createWriteStream, writeFile } from "node:fs";

import type { RecurringSub } from "./lib/utils.ts";

import {
  emailEncrypt,
} from "./lib/email.ts";

import {
  paypalConnect,
  paypalCondensedSubs,
} from "./lib/paypal.ts";

import {
  stripeConnect,
  stripeCondenseSub,
} from "./lib/stripe.ts";

import {
  sfConnect,
  sfEmailsToContacts,
  type SfContactRecord
} from "./lib/salesforce.ts";

import cnp from "./private/cnp.json" with {type: "json"};

  
const subs: RecurringSub[] = [];


// Get all active recurring subscriptions from Stripe.
const stripe = stripeConnect();
let start = performance.now();
for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100, expand:["data.customer"] })) {
  subs.push(stripeCondenseSub(sub));
}
console.error(`Retrieved ${subs.length} Stripe subscriptions in ${(performance.now() - start)/1000}s`);


// Get all active recurring subscriptions from PayPal.
const paypal = paypalConnect();
start = performance.now();
const paypalSubs = await paypalCondensedSubs(paypal);
subs.push(...paypalSubs);
console.error(`Retrieved ${paypalSubs.length} PayPal subscriptions in ${(performance.now() - start)/1000}s`);


// Get all recurring subscriptions from manually-collected Click and Pledge data.
for (const sub of cnp) {
  let freq: RecurringSub["frequency"];
  if (sub.Frequency === "Month" || sub.Frequency === "Quarter" || sub.Frequency === "Year") {
    freq = sub.Frequency;
  } else {
    freq = "Month";
  }
  subs.push({
    id: sub["Donor Portal Link"],
    since: sub.Since,
    lead: "CnP",
    email: sub.Email,
    designation: sub.Designation,
    firstName: sub["First Name"],
    lastName: sub["Last Name"],
    amount: sub.Amount,
    frequency: freq,
  });
}
console.error(`Retrieved ${cnp.length} subscriptions from manually-collected Click and Pledge data`);


// Sort subs by decreasing "since" date (latest first).
subs.sort(({since: a}, {since: b}) => b.localeCompare(a));


// Get Salesforce contacts for each listed email.
const sf = await sfConnect();
start = performance.now();
const contacts = await sfEmailsToContacts(sf, subs.map(sub => sub.email as string));
console.error(`Found SF contacts for ${subs.length} emails in ${(performance.now() - start)/1000}s`);


const headers = [
  "First Name",
  "Last Name",
  "Email",
  "Designation",
  "Amount",
  "Frequency",
  "Yearly Value",
  "Since",
  "CRM Contact ID",
  "Processor Subscription ID",
  "Link ID",
  "Lead",
];

let w = createWriteStream("./private/recurring.csv");

w.write(headers.join(",") + "\n");

const subMap: Record<string,any> = {};
const emailMap: Record<string,string> = {};

for (let i = 0; i < subs.length; ++i) {
  const sub = subs[i];
  
  const npayments = sub.frequency === "Year"? 1 : (sub.frequency === "Quarter"? 4 : 12);
  
  const encEmail = emailEncrypt(sub.email);
  if (!encEmail) {
    throw new Error(`${sub.id}: missing customer email / encryption failed`);
  }

  const line: string[] = [
    contacts[i]?.first || sub.firstName || "",
    contacts[i]?.last || sub.lastName || "",
    sub.email as string,
    sub.designation,
    sub.amount.toFixed(2),
    sub.frequency,
    (sub.amount*npayments).toFixed(2),
    sub.since.split("T")[0],
    contacts[i]?.id || "UNKNOWN",
    sub.id,
    encEmail,
    sub.lead
  ];
  w.write(line.join(",") + "\n");

  if (!subMap[encEmail]) {
    subMap[encEmail] = {
      name: (line[0] + " " + line[1]).trim(),
      subs: [],
    };
  }
  subMap[encEmail].subs.push({
    designation: line[3],
    amount: line[4],
    frequency: line[5],
    since: line[7],
    id: line[9],
    lead: line[11],
  });

  if (contacts[i]) {
    for (const nemail of (contacts[i] as SfContactRecord).emails) {
      if (nemail) {
        emailMap[emailEncrypt(nemail) as string] ||= encEmail;
      }
    }
  }
}

w.end();

writeFile("./private/recurring.json", JSON.stringify(subMap, null, 2), ()=>{});
writeFile("./private/email-map.json", JSON.stringify(emailMap, null, 2), ()=>{});