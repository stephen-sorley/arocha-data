#!/usr/bin/env node

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

import {
  processorFromId,
  type RecurringSub
} from "./lib/utils.ts";

import type {
  ManagerEmailMap,
  ManagerSubInfo
} from "./private/manager.d.ts";

import {
  emailEncrypt,
  emailNorm,
} from "./lib/email.ts";

import {
  paypalConnect,
  paypalNormalizeSub,
  paypalListSubs,
} from "./lib/paypal.ts";

import {
  stripeConnect,
  stripeNormalizeSub,
  stripeListSubs,
} from "./lib/stripe.ts";

import {
  sfConnect,
  sfEmailsToContacts,
} from "./lib/salesforce.ts";

import cnp from "./private/cnp.json" with {type: "json"};

  
const subs: RecurringSub[] = [];


// Get all active recurring subscriptions from Stripe.
const stripe = stripeConnect();
let start = performance.now();
const stripeSubs = await stripeListSubs(stripe);
for (const sub of stripeSubs) {
  subs.push(stripeNormalizeSub(sub))
}
console.error(`Retrieved ${subs.length} Stripe subscriptions in ${(performance.now() - start)/1000}s`);


// Get all active recurring subscriptions from PayPal.
const paypal = paypalConnect();
start = performance.now();
const paypalSubs = await paypalListSubs(paypal);
for (const sub of paypalSubs) {
  const nsub = paypalNormalizeSub(sub);
  if (nsub) {
    subs.push(nsub);
  }
}
console.error(`Retrieved ${paypalSubs.length} PayPal subscriptions in ${(performance.now() - start)/1000}s`);


// Get all recurring subscriptions from manually-collected Click and Pledge data.
for (const sub of cnp) {
  let freq: RecurringSub["frequency"];
  if (sub.Frequency === "month" || sub.Frequency === "quarter" || sub.Frequency === "year") {
    freq = sub.Frequency;
  } else {
    freq = "month";
  }
  subs.push({
    id: sub["Donor Portal Link"],
    since: sub.Since,
    lead: "CnP",
    email: emailNorm(sub.Email),
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
const {
  emailToContact,
  accountToEmails
} = await sfEmailsToContacts(sf, subs.map(sub => sub.email as string));
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
  "CRM Account ID",
  "Processor Subscription ID",
  "Link ID",
  "Lead",
];

let w = createWriteStream("./private/recurring.csv");

w.write(headers.join(",") + "\n");

const managerSubInfo: ManagerSubInfo = {};

for (const sub of subs) {
  const encEmail = emailEncrypt(sub.email);
  if (!sub.email || !encEmail) {
    throw new Error(`${sub.id}: missing customer email / encryption failed`);
  }

  const contact = emailToContact.get(sub.email);

  if (!contact || !contact.account) {
    throw new Error(`${sub.id}: missing SF contact or account for ${sub.firstName} ${sub.lastName} <${sub.email}>`);
  }

  const npayments = sub.frequency === "year"? 1 : (sub.frequency === "quarter"? 4 : 12);
  
  const amount = sub.amount.toFixed(2);
  const yearlyValue = (sub.amount*npayments).toFixed(2);
  const since = sub.since.split("T")[0];
  const firstName = (contact.first || sub.firstName || "").trim();
  const lastName = (contact.last || sub.lastName || "").trim();

  const line: string[] = [
    firstName, //prefer the name in Salesforce, if it's there
    lastName, //prefer the name in Salesforce, if it's there
    sub.email,
    sub.designation,
    amount,
    sub.frequency,
    yearlyValue,
    since,
    contact.id,
    contact.account,
    sub.id,
    encEmail,
    sub.lead
  ];
  w.write(line.join(",") + "\n");

  const managerSubs = managerSubInfo[contact.account] || [];
  if (managerSubs.length === 0) {
    managerSubInfo[contact.account] = managerSubs;
  }
  managerSubs.push({
    designation: sub.designation,
    amount: amount,
    frequency: sub.frequency,
    since: since,
    contactId: contact.id,
    processorId: sub.id,
    processor: processorFromId(sub.id),
  });
}

w.end();

writeFile("./private/recurring.json", JSON.stringify(managerSubInfo, null, 2), ()=>{});


const managerEmailMap: ManagerEmailMap = {};
for (const [account, emails] of accountToEmails.entries()) {
  for (const email of emails) {
    const encEmail = emailEncrypt(email);
    if (managerEmailMap[email]) {
      throw new Error(`duplicate email detected: ${email}`);
    }
    if (!encEmail) {
      throw new Error(`encryption failed: ${email}`);
    }
    managerEmailMap[encEmail] = account;
  }
}
writeFile("./private/email-map.json", JSON.stringify(managerEmailMap, null, 2), ()=>{});

console.error(`\nFinished: ${subs.length} subscriptions, ${Object.keys(managerEmailMap).length} emails, ${accountToEmails.size} accounts`);