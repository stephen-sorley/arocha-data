#!/usr/bin/env -S node --harmony-temporal

/**
 * Pull data on every contact in Salesforce, then figure out which ones we
 * want to keep.
 */

import { sfConnect } from "./lib/salesforce.ts";
import { cmGetSubs } from "./lib/campaign-monitor.ts";

import type {
  Individual,
  Household,
  Organization,
} from "./lib/final_types.ts"


// Set parameters for what contacts and transactions we'll keep.
const allGiftsWindow = 5; // how long do we keep households who've made any donation at all?
const largeGiftsWindow = 10; // how long do we keep households who've donated a lot?
const largeGiftThreshold = 1000; // how many dollars is considered a lot of donations?

const currentYear = Temporal.Now.plainDateISO().year;
const allMinDate = Temporal.PlainDate.from(`${currentYear - allGiftsWindow}-01-01`);
const largeMinDate = Temporal.PlainDate.from(`${currentYear - largeGiftsWindow}-01-01`);

// Get current mailing list subscription records.
let start = performance.now();
const mailingListSubs = await cmGetSubs({
  state: "Active",
  restrict: [
    "Master List",
    "Climate Stewards",
    "Church Partners",
    "Mighty Network Members",
  ],
});
console.error(`Retreived ${mailingListSubs.size} active CM subscribers in ${Math.round(performance.now() - start)/1000}s`);

const out: {
  organizations: Organization[],
  households: Household[],
  individuals: Individual[],
} = {
  organizations: [],
  households: [],
  individuals: [],
}

const sf = await sfConnect();

const accountFields = [
  "Id",
  "Name",
  "Type",
  "BillingStreet",
  "BillingCity",
  "BillingState",
  "BillingPostalCode",
  "BillingCountry",
  "Phone",
  "website",
  "CreatedDate",
  "Description",
  "npe01__One2OneContact__c" //primary contact ID
];


const emailFields = [
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
  "FirstName",
  "LastName",
  "Title",
  "Salutation",
  "Email", //preferred email field, for detecting any data errors only
  "npe01__Preferred_Email__c", // "Home" | "Work" | "Alternate"
  ...emailFields,
  "npe01__PreferredPhone__c", // "Home" | "Work" | "Mobile" | "Other"
  "HomePhone",
  "npe01__WorkPhone__c",
  "MobilePhone",
  "OtherPhone",
  f_lastGiftDate,
  f_largestHardYearTotal,
  f_largestSoft,
  f_affiliation,
  "DoNotCall",
  "Do_Not_Mail__c",
  "npe01__Primary_Address_Type__c", // "Home" | "Work" | "Other"
  "MailingStreet",
  "MailingCity",
  "MailingState",
  "MailingPostalCode",
  "MailingCountry",
  "npe01__Secondary_Address_Type__c", // "Home" | "Work" | "Other"
  "OtherStreet",
  "OtherCity",
  "OtherState",
  "OtherPostalCode",
  "OtherCountry",
  "CreatedDate",
  "Description"
];

const normEmail = (email?: string) => {
  return email?.trim().toLocaleLowerCase();
}

const cleanName = (name?: string) => {
  if (name?.toLocaleLowerCase()?.includes("not provided")) {
    return undefined;
  }
  return name;
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

const translateSfEmailPref = (sfPreferredEmail?: string) => {
  switch(sfPreferredEmail?.trim()?.toLocaleLowerCase()) {
    case "work": return "work";
    case "alternate": return "alt";
  }
  return "home";
}

const translateSfPhonePref = (sfPreferredPhone?: string) => {
  switch(sfPreferredPhone?.trim()?.toLocaleLowerCase()) {
    case "work": return "work";
    case "mobile": return "mobile";
    case "other": return "alt";
  }
  return "home";
}

const translateSfAddressType = (sfAddressType?: string) => {
  switch(sfAddressType?.trim()?.toLocaleLowerCase()) {
    case "work": return "work";
    case "other": return "alt";
  }
  return "home";
}

const translateSfAccountType = (sfAccountType?: string) => {
  switch(sfAccountType?.trim()?.toLocaleLowerCase()) {
    case "church": return "church";
    case "nonprofit": return "nonprofit";
    case "foundation": return "foundation";
    case "school / univ": return "school";
    case "government": return "government";
    case "daf": return "daf";
    case "household": return "household";
    case "corporate": return "corporate";
  }
  return undefined;
};

let numDiscrete = 0; // number of contacts + number of organization accounts.
let numOrgs = 0; // number of organization accounts
let numToKeep = 0; // number of discrete entities we wish to keep around.
let bloomerang = 0;
let virtuous = 0;

// Get records from all accounts, and their associated contacts.
const sfEmails = new Set<string>;
start = performance.now();
await sf
  .query(`SELECT ${accountFields.join(",")},(SELECT ${contactFields.join(",")} FROM Contacts) FROM Account`)
  .on("record", (account) => {
    
    const contacts = (account.Contacts?.records as Record<string, any>[]) || [];
    const contactToObj = (contact: typeof contacts[0], parent?: string): Individual => ({
      parent: parent,
      id: contact.Id,
      salutation: contact.Salutation,
      firstName: cleanName(contact.FirstName),
      lastName: cleanName(contact.LastName),
      title: contact.Title,
      primaryAffiliation: contact[f_affiliation],
      primaryAddress: {
        street: contact.MailingStreet,
        city: contact.MailingCity,
        state: contact.MailingState,
        zip: contact.MailingPostalCode,
        country: contact.MailingCountry,
        type: translateSfAddressType(contact.npe01__Primary_Address_Type__c),
      },
      secondaryAddress: {
        street: contact.OtherStreet,
        city: contact.OtherCity,
        state: contact.OtherState,
        zip: contact.OtherPostalCode,
        country: contact.OtherCountry,
        type: translateSfAddressType(contact.npe01__Secondary_Address_Type__c),
      },
      email: {
        home: contact[emailFields[0]],
        work: contact[emailFields[1]],
        alt: contact[emailFields[2]],
        preferred: translateSfEmailPref(contact.npe01__Preferred_Email__c),
      },
      phone: {
        home: contact.HomePhone,
        mobile: contact.MobilePhone,
        work: contact.npe01__WorkPhone__c,
        alt: contact.OtherPhone,
        preferred: translateSfPhonePref(contact.npe01__PreferredPhone__c),
      },
      doNotCall: contact.DoNotCall,
      doNotMail: contact.Do_Not_Mail__c,
      created: contact.CreatedDate,
      description: contact.Description,
    });

    const type = translateSfAccountType(account.Type);
    if (!type) {
      console.error(`Account ${account.Id} has no type.`);
    }

    // For non-household accounts, the account itself is a constituent, as well as
    // all contacts that belong to it.
    if (type !== "household") {
      numOrgs++;
      numDiscrete += contacts.length + 1;
      numToKeep += contacts.length + 1;
      virtuous++;
      bloomerang += contacts.length + 1;

      out.organizations.push({
        id: account.Id,
        name: account.Name,
        type: type,
        primaryContact: account["npe01__One2OneContact__c"],
        address: {
          street: account.BillingStreet,
          city: account.BillingCity,
          state: account.BillingState,
          zip: account.BillingPostalCode,
          country: account.BillingCountry,
        },
        phone: account.Phone,
        website: account.Website,
        created: account.CreatedDate,
        description: account.Description,
      });
      for (const contact of contacts) {
        out.individuals.push(contactToObj(contact, account.Id));
      }
      return;
    }
    
    if (contacts.length === 0) {
      console.error(`Household account ${account.Id} has no contacts.`);
      return;
    }

    // For household accounts, contacts must meet certain criteria to be retained
    // as a constituent. Note that we don't count the household as a separate constituent.
    numDiscrete += contacts.length;
    let keep = false;
    let householdLastGiftDate = undefined;
    let householdBestGiftAmount = 0;
    for (const contact of contacts) {
      let matchedPreferred = false;
      let foundEmail: string | undefined;
      for (const efield of emailFields) {
        const email = normEmail(contact[efield]);
        if (email) {
          foundEmail ??= email;
          matchedPreferred ||= contact["Email"] && normEmail(contact["Email"]) === email;
          if (sfEmails.has(email.toLocaleLowerCase())) {
            console.error("warning, duplicate email: " + email);
          } else {
            sfEmails.add(email.toLocaleLowerCase());
          }
        }
      }

      if (foundEmail && !matchedPreferred) {
        console.error("warning, preferred email mismatch: " + foundEmail);
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
      bloomerang++;
      virtuous++;

      // Note: only save the household if it has more than one person in it.
      if (contacts.length > 1) {
        out.households.push({
          id: account.Id,
          name: account.Name,
          primaryContact: account.npe01__One2OneContact__c,
          created: account.CreatedDate,
        });
      }

      for (const contact of contacts) {
        out.individuals.push(contactToObj(contact, contacts.length>1? account.Id : undefined));
      }
    }
  })
  .execute({ autoFetch: true });
console.error(`Retrieved ${numDiscrete} constituents from SF in ${Math.round(performance.now() - start)/1000}s`);

// Add any active subscribers in CM that are missing from Salesforce.
let numMissing = 0;
for (const [email, sub] of mailingListSubs.entries()) {
  if (!sfEmails.has(email)) {
    numMissing++;
    //TODO: add individuals from signups that aren't in salesforce.
  }
}
numDiscrete += numMissing;
numToKeep += numMissing;
bloomerang += numMissing;
virtuous += numMissing;
console.error(`Warning: ${numMissing} active subscribers in CM were not in SF, adding them in.`);

console.error(`
========================================
Original constituents: ${numDiscrete}
  Organizations      : ${numOrgs}
  Individuals        : ${numDiscrete-numOrgs}

Constituents retained: ${numToKeep}
Constituents dropped : ${numDiscrete - numToKeep}

Billable Contacts
  Bloomerang         : ${bloomerang}
  Virtuous           : ${virtuous}
========================================
`);

console.log(JSON.stringify(out,null,2));