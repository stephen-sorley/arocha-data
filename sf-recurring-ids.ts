#!/usr/bin/env node

/**
 * Try to match Salesforce recurring donations to our subscription records from
 * the processors.
 * 
 * If we find a match, store the processor ID in the SF recurring donation object.
 * 
 * If we don't find a match, print out details so we can resolve whatever data
 * issue is causing the problem.
 */

const sfSubUrl = "https://arochausa.lightning.force.com/lightning/r/npe03__Recurring_Donation__c";
const stripeSubUrl = "https://dashboard.stripe.com/subscriptions";
const paypalSubUrl = "https://www.paypal.com/billing/subscriptions";

import {
  sfConnect,
} from "./lib/salesforce.ts";

import subInfo_gen from "./private/recurring.json" with {type: "json"};
import type {
  ManagerSubInfo
} from "./private/manager.d.ts";
const accountsToProcSubs = subInfo_gen as ManagerSubInfo;

const sf = await sfConnect();

// Get all active salesforce subscriptions.

type Update = {
  Id: string,
  Processor_Id__c: string
};
const updatesToMake: Update[] = [];

const fields = [
  "Id",
  "npe03__Amount__c",
  "npe03__Organization__c",
  "npe03__Recurring_Donation_Campaign__r.Name",
  "npsp__PaymentMethod__c",
  "Lead_Source__c",
  "Processor_Id__c"
];
const soql =`
  SELECT ${fields.join(",")}
  FROM npe03__Recurring_Donation__c
  WHERE npsp__Status__c = 'Active'`;

const sfSubs = (await sf.query(soql))?.records;
for (const sub of sfSubs) {
  const acct = sub["npe03__Organization__c"];
  if (!acct) {
    console.error("SF sub is missing an account:\n" + JSON.stringify(sub, null, 2) + "\n");
  }

  // If we already set a processor ID, skip.
  if (sub["Processor_Id__c"]) {
    continue;
  }

  // Silently skip recurring paper check donations - no id to add.
  const leadSource = sub["Lead_Source__c"];
  if (leadSource !== "Website - GiveWP" &&
     ["ACH/EFT","Cash","Check","Auto Check"].includes(sub["npsp__PaymentMethod__c"])) {
    continue;
  }

  const sfSub = {
    designation: sub["npe03__Recurring_Donation_Campaign__r"]?.Name || "",
    amount: (sub["npe03__Amount__c"] || 0) as number,
    id: sub.Id || "",
  };

  const procSubs = accountsToProcSubs[acct];
  const matches: ManagerSubInfo[string]["subs"] = [];

  if (procSubs?.subs) {
    for (const procSub of procSubs.subs) {
      if ( 
        (
          sfSub.designation.startsWith("Global Conservation Fund")
          &&
          procSub.designation.startsWith("Global Conservation Fund")
        ) 
        ||
        (
          procSub.designation === sfSub.designation
          &&
          parseFloat(procSub.amount) === sfSub.amount
        ) ) {
        matches.push(procSub);
      }
    }
  }
  if (matches.length === 0) {
    console.error(
      `Bad match: subscription not present in processor data - ${sfSubUrl}/${sfSub.id}/view` +
      `\nCandidates: ($${sfSub.amount.toFixed(2)} - ${sfSub.designation})`
    );
    if (procSubs?.subs) {
      for (const procSub of procSubs.subs) {
        console.error(`  $${procSub.amount} - ${procSub.designation} - ${procSub.processorId}`)
      }
    }

  } else if (matches.length >= 2) {
    console.error(
      `Duplicate match: multiple subscriptions in processor data match with SF sub.` +
      `  SF sub: ${sfSubUrl}/${sfSub.id}/view`
    );
    for (const procSub of matches) {
      if (procSub.processorId.startsWith("sub_")) {
        console.error(
      `  Stripe: ${stripeSubUrl}/${procSub.processorId}`
        );
      } else if (procSub.processorId.startsWith("I-")) {
        console.error(
      `  PayPal: ${paypalSubUrl}/${procSub.processorId}`
        );
      } else {
        console.error(
      `  CnP   : ${procSub.processorId}`
        );
      }
    }
  } else {
    updatesToMake.push({
      Id: sfSub.id,
      Processor_Id__c: matches[0].processorId
    });
  }
}

if (updatesToMake.length) {
  const results = await sf.bulk2.loadAndWaitForResults({
    object: 'npe03__Recurring_Donation__c',
    operation: 'update',
    input: updatesToMake
  });

  console.log(`Successful records: ${JSON.stringify(results.successfulResults, null, 2)}`);
  console.error(`Failed records: ${JSON.stringify(results.failedResults, null, 2)}`);
  console.error(`Unprocessed records: ${JSON.stringify(results.unprocessedRecords, null, 2)}`);
}