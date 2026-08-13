#!/usr/bin/env node

import * as dotenv from "dotenv";
import { setTimeout } from 'node:timers/promises';
import Stripe from "stripe";
import { Connection } from "jsforce";

import ids from "./givewp-recurring.json" with { type: 'json' };
import { exit } from "node:process";

dotenv.config({quiet: true});

const fromEnv = (name: string) => {
  const val: string | undefined = process.env[name];
  if (!val) {
    throw new Error(`${name} missing from environemnt, add it to .env?`);
  }
  return val;
};

const STRIPE_KEY = fromEnv("STRIPE_KEY");
const SF_ID = fromEnv("SF_ID");
const SF_KEY = fromEnv("SF_KEY");

// Connect to our Stripe account.
const stripe = new Stripe(STRIPE_KEY, {
  telemetry: false
});

// Connect to our Salesforce account.
const sf = new Connection({
  loginUrl: 'https://arochausa.my.salesforce.com',
  oauth2: {
    clientId: SF_ID,
    clientSecret: SF_KEY,
  },
  refreshFn: async (connection, callback) => {
    try {
      await connection.authorize({ grant_type: 'client_credentials' });
      callback(null, connection.accessToken || undefined);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));;
    }
  }
});
await sf.authorize({ grant_type: 'client_credentials' });
// END Salesforce create connection.

async function getSub(id: string) {
  return stripe.subscriptions.retrieve(id, {
    expand: ["customer", "items.data.price.product"],
  });
}

async function getAllActiveSubs() {
  const activeSubs: Stripe.Subscription[] = [];
  for await(const sub of stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.customer", "data.items.data.price.product",]
  })) {
      activeSubs.push(sub);
  }
  return activeSubs;
}

let start = performance.now();
const subs: Stripe.Subscription[] = [];
const chunk = 10;
for (let i=0; i<ids.length; i+=chunk) {
  if (i > 0) {
    await setTimeout(100);
  }
  const temp = await(Promise.all(ids.slice(i,i+chunk).map(id => getSub(id))));
  subs.push(...temp);
}
await(Promise.all(ids.map(id => getSub(id))));
console.error(`\nRetrieved ${subs.length} subscriptions in ${(performance.now() - start)/1000}s`);

// Sort in descending order (newest first).
subs.sort((a,b) => b.start_date - a.start_date);

// Extract email addresses.
const emails = subs.map( sub => (sub.customer as Stripe.Customer).email?.toLocaleLowerCase() );
const uniqueEmails = [...new Set(emails)];

const fields = [
  "Email",
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
   "npe01__AlternateEmail__c"
];

start = performance.now();
const sfChunk = 50;
const emailToContactMap = new Map<string,string>();
for (let i = 0; i < uniqueEmails.length; i += sfChunk) {
  const emailStr = uniqueEmails.slice(i, i + sfChunk).map(email => `'${email}'`).join(",");
  const soql = `
    SELECT Id, Email, npe01__HomeEmail__c, npe01__WorkEmail__c, npe01__AlternateEmail__c
    FROM Contact
    WHERE Email IN (${emailStr})
        OR npe01__HomeEmail__c IN (${emailStr})
        OR npe01__WorkEmail__c IN (${emailStr})
        OR npe01__AlternateEmail__c IN (${emailStr})
    LIMIT 2000
  `;

  const res = await sf.query(soql);
  res.records.forEach(record => {
    for(const field of fields) {
      if (record[field] && record.Id) {
        emailToContactMap.set(record[field], record.Id);
      }
    }
  });
}
console.error(`\nRetrieved ${emailToContactMap.size} email mappings in ${(performance.now() - start)/1000}s`);

for (const email of emails) {
  console.log((email && emailToContactMap.get(email)) || "UNKNOWN");
}

exit();


let i=0;
for (const sub of subs) {
  i++;

  /*
  let designation: string | undefined;

  const prodName = (sub.items.data[0].price.product as Stripe.Product)?.name;
  const desTo = sub.metadata?.["Designate to"] || sub.metadata?.["Designated to"];
  const intlProj = sub.metadata?.["International Projects"];
  const usProj = sub.metadata?.["US Projects"];
  const other = sub.metadata?.["Other Designation"];
  const all = [designation, prodName, desTo, intlProj, usProj, other];

  const checkAll = (name: string) => all.some(des => {
    return des && des.toLocaleLowerCase().includes(name.toLocaleLowerCase());
  });

  const usNames = [
    "Brown",
    "Chuang",
    "Guthrie",
    "Henderson",
    "Huska",
    "Lamb",
    "Michalski",
    "Sluka",
    "Walton",
  ];
  for (const name of usNames) {
    if (checkAll(name)) {
      designation = `USA-(${name})`;
      break;
    }
  }

  const canadaNames = [
    "Anderson",
    "Faw",
    "Kostamo",
    "Richmond"
  ];
  for (const name of canadaNames) {
    if (checkAll(name)) {
      designation = `Canada-${name}`;
      break;
    }
  }

  if (!designation && checkAll("Social Media and Content Coordinator")) {
    designation = "Social Media and Content Coordinator (Autumn Ayers)";
  }

  if (!designation && checkAll("Global Conservation Fund")) {
    designation = "Global Conservation Fund(GCF)-ARI";
  }

  if (!designation && checkAll("Costa Rica")) {
    designation = "Casa Adobe/Costa Rica";
  }

  if (!designation && checkAll("Church Engagement")) {
    designation = "USA-Church Engagement";
  }
  if (!designation && checkAll("Conservation Internships")) {
    designation = "USA-Conservation Interns";
  }
  if (!designation && checkAll("Florida Conservation Project")) {
    designation = "USA-Florida Conservation Project";
  }
  if (!designation && checkAll("Tennessee Conservation Project")) {
    designation = "USA-Tennessee Conservation Project";
  }
  if (!designation && checkAll("Texas Conservation Project")) {
    designation = "USA-Texas Conservation Project";
  }

  if (!designation) {
    const exactNames = [
      "Climate Stewards",
      "Canada",
      "Kenya"
    ];
    for (const name of exactNames) {
      if (checkAll(name)) {
        designation = name;
        break;
      }
    }
  }

  if (!designation && checkAll("International")) {
    designation = "ARI";
  }

  if (!designation) {
    designation = "USA";
  }

  console.log(designation);
  //*/

  /*
  console.log(`
Sub ${i} of ${subs.length}: ${sub.id}
  Product name: ${(sub.items.data[0].price.product as Stripe.Product)?.name}
  Designate to: ${sub.metadata?.["Designate to"]}
  Designated to: ${sub.metadata?.["Designated to"]}
  International Projects: ${sub.metadata?.["International Projects"]}
  US Projects: ${sub.metadata?.["US Projects"]}
  Other Designation: ${sub.metadata?.["Other Designation"]}
  Notes: ${sub.metadata?.["Notes"]}
` );
  //*/
  /*
  console.log(`
Sub ${i} of ${subs.length}: ${sub.id}
${JSON.stringify(sub.metadata, null, 2)}
` );
  //*/
}