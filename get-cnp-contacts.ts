#!/usr/bin/env node

/* Finds the Salesforce Contact ID for each Click 'n Pledge subscription.
 *
 */

import * as dotenv from "dotenv";
import { Connection } from "jsforce";

import cnp from "./private/cnp.json" with {type: "json"};

dotenv.config({quiet: true});

const fromEnv = (name: string) => {
  const val: string | undefined = process.env[name];
  if (!val) {
    throw new Error(`${name} missing from environemnt, add it to .env?`);
  }
  return val;
};

const SF_ID = fromEnv("SF_ID");
const SF_KEY = fromEnv("SF_KEY");

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

// Extract emails from Click and Pledge data.
const emails = cnp.map(rec => rec["Email"].toLocaleLowerCase());
emails.sort();
const uniqueEmails = [...new Set(emails)];

// Get salesforce contact for each email.
const fields = [
  "Email",
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
  "npe01__AlternateEmail__c"
];

let start = performance.now();
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
        emailToContactMap.set(record[field].toLocaleLowerCase(), record.Id);
      }
    }
  });
}
console.error(`\nRetrieved ${emailToContactMap.size} email mappings in ${(performance.now() - start)/1000}s`);

// Output list of contacts.
for (const email of emails) {
  const id = emailToContactMap.get(email);
  if (!id) {
    console.error("Email not found in SF: " + email);
  }
  console.log(id || "UNKNOWN");
}