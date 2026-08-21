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
  emailNorm,
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

const accountToSub: Record<string,any> = {};

for (const sub of subs) {
  const encEmail = emailEncrypt(sub.email);
  if (!sub.email || !encEmail) {
    throw new Error(`${sub.id}: missing customer email / encryption failed`);
  }

  const contact = emailToContact.get(sub.email);

  if (!contact || !contact.account) {
    throw new Error(`${sub.id}: missing SF contact or account for ${sub.firstName} ${sub.lastName} <${sub.email}>`);
  }

  const npayments = sub.frequency === "Year"? 1 : (sub.frequency === "Quarter"? 4 : 12);
  
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

  const acctSubs = accountToSub[contact.account]?.subs || [];
  if (acctSubs.length === 0) {
    accountToSub[contact.account] = {
      name: (firstName + " " + lastName).trim(),
      subs: acctSubs,
    };
  }
  acctSubs.push({
    designation: sub.designation,
    amount: amount,
    frequency: sub.frequency,
    since: since,
    contactId: contact.id,
    lead: sub.lead,
  });
}

w.end();

writeFile("./private/recurring.json", JSON.stringify(accountToSub, null, 2), ()=>{});


const emailToAccount: Record<string,string> = {};
for (const [account, emails] of accountToEmails.entries()) {
  for (const email of emails) {
    const encEmail = emailEncrypt(email);
    if (emailToAccount[email]) {
      throw new Error(`duplicate email detected: ${email}`);
    }
    if (!encEmail) {
      throw new Error(`encryption failed: ${email}`);
    }
    emailToAccount[encEmail] = account;
  }
}
writeFile("./private/email-map.json", JSON.stringify(emailToAccount, null, 2), ()=>{});

console.error(`\nFinished: ${subs.length} subscriptions, ${Object.keys(emailToAccount).length} emails, ${accountToEmails.size} accounts`);