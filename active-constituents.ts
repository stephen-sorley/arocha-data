#!/usr/bin/env -S node --harmony-temporal

/**
 * Pull data on every contact in Salesforce, then figure out which ones we
 * want to keep.
 */

import {
  sfConnect,
  cmGetSubs,
} from "./lib/utils.ts"


// Set parameters for what contacts and transactions we'll keep.
const allGiftsWindow = 5; // keep contacts who've given within the past 5 calendar years.
const largeGiftsWindow = 10; // keep contacts who've made big gifts within the past 7 calendar years.
const largeGiftThreshold = 1000; // how big is a "large" donation?

const currentYear = Temporal.Now.plainDateISO().year;
const allMinDate = Temporal.PlainDate.from(`${currentYear - allGiftsWindow}-01-01`);
const largeMinDate = Temporal.PlainDate.from(`${currentYear - largeGiftsWindow}-01-01`);


// Get current mailing list subscription records.
let start = performance.now();
const mailingListSubs = await cmGetSubs("Active");
console.error(`Retreived ${mailingListSubs.size} active CM subscribers in ${Math.round(performance.now() - start)/1000}s`);

const sf = await sfConnect();

const accountFields = [
  "Id",
  "Type"
];


const emailFields = [
  "Email",
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
  "npe01__AlternateEmail__c"
];

const f_lastGiftDate = "Last_Gift_Date_Soft_or_Hard_All_Time__c";
const f_largestHardYearTotal = "npo02__Best_Gift_Year_Total__c";
const f_largestSoft = "npsp__Largest_Soft_Credit_Amount__c";
const f_affiliation = "npsp__Primary_Affiliation__c";

const contactFields = [
  "Id", // contact ID
  "AccountId",
  ...emailFields,
  f_lastGiftDate,
  f_largestHardYearTotal,
  f_largestSoft,
  f_affiliation
];

type Contact = {
  id: string,
  lastGiftDate?: Temporal.PlainDate,
  bestGift: number,
  emails: string[],
  hasAffiliation: boolean,
};

type Account = {
  id: string,
  contacts: Contact[],
}

const contactOnMailingList = (sfContact: any) => {
  for (const efield of emailFields) {
    const email = sfContact[efield];
    if (email && mailingListSubs.has(email.toLocaleLowerCase())) {
      return true;
    }
  }
  return false;
};

const accounts = new Map<string, Account>();
let numDiscrete = 0; // number of contacts + number of organization accounts.
let numOrgs = 0; // number of organization accounts
let numToKeep = 0; // number of discrete entities we wish to keep around.

// Get records from all accounts, and their associated contacts.
const sfEmails = new Set<string>;
start = performance.now();
await sf
  .query(`SELECT ${accountFields.join(",")},(SELECT ${contactFields.join(",")} FROM Contacts) FROM Account`)
  .on("record", (account) => {
    
    // Count all accounts that don't have contacts attached to them as constituents.
    if (!account.Contacts) {
      numDiscrete++;
      numOrgs++;
      numToKeep++;
      return;
    }
    const contacts = account.Contacts.records as Record<string, any>[];

    // For non-household accounts, the account itself is a constituent, as well as
    // all contacts that belong to it.
    if (account.Type !== "Household") {
      numDiscrete += contacts.length + 1;
      numToKeep += contacts.length + 1;
      return;
    }

    // For household accounts, contacts must meet certain criteria to be retained
    // as a constituent. Note that we don't count the household as a separate constituent.
    numDiscrete += contacts.length;
    let keep = false;
    let householdLastGiftDate = undefined;
    let householdBestGiftAmount = 0;
    for (const contact of contacts) {
      for (const efield of emailFields) {
        const email = contact[efield];
        if (email) {
          sfEmails.add(email.toLocaleLowerCase());
        }
      }

      // Mark all as constituents if any contact in the household is an active subscriber
      // to a CM mailing list.
      keep ||= contactOnMailingList(contact);

      // Mark all as constituents if any contact in the household has a primary org affiliation.
      keep ||= contact[f_affiliation];

      // Aggregate gift amount and most recent gift date, for gift threshold metric.
      const bestGiftAmount = (contact[f_largestHardYearTotal]||0) + (contact[f_largestSoft]||0);
      if (bestGiftAmount > householdBestGiftAmount) {
        householdBestGiftAmount = bestGiftAmount;
      }

      const lastGiftDate = contact[f_lastGiftDate]? Temporal.PlainDate.from(contact[f_lastGiftDate]) : undefined;
      if (lastGiftDate && (!householdLastGiftDate || Temporal.PlainDate.compare(lastGiftDate, householdLastGiftDate) > 0)) {
        householdLastGiftDate = lastGiftDate;
      }
    }

    // If we haven't marked the contacts as constituents yet, do so if the household has donors
    // whose giving was within our date thresholds.
    const minDate = (householdBestGiftAmount >= largeGiftThreshold)? largeMinDate : allMinDate;
    keep ||= householdBestGiftAmount > 0 && (!householdLastGiftDate || Temporal.PlainDate.compare(householdLastGiftDate, minDate) >= 0);

    if (keep) {
      numToKeep += contacts.length;
    }

    /*
    const contact: Contact = {
      id: record.Id,
      lastGiftDate: record[f_lastGiftDate]? Temporal.PlainDate.from(record) : undefined,
      bestGift: (record[f_largestHardYearTotal]||0) + (record[f_largestSoft]||0),
      emails: [],
      hasAffiliation: !!record[f_affiliation],
    };
    const emailsSet = new Set<string>();
    for (const efield of emailFields) {
      const email = record[efield];
      if (email) {
        emailsSet.add(email.toLocaleLowerCase());
      }
    }
    contact.emails = [...emailsSet];
    */

  })
  .execute({ autoFetch: true });
console.error(`Retrieved ${numDiscrete} constituents from SF in ${Math.round(performance.now() - start)/1000}s`);

// Add any active subscribers in CM that are missing from Salesforce.
let numMissing = 0;
for (const [email,val] of mailingListSubs.entries()) {
  if (!sfEmails.has(email)) {
    numDiscrete++;
    numToKeep++;
    numMissing++;
  }
}
console.error(`Warning: ${numMissing} active subscribers in CM were not in SF, adding them in.`);

console.log(`
========================================
Discrete constituents: ${numDiscrete}
  Organizations      : ${numOrgs}
  Individuals        : ${numDiscrete-numOrgs}

Constituents retained: ${numToKeep}
Constituents dropped : ${numDiscrete - numToKeep}
========================================
`);