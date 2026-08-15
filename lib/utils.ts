import * as dotenv from "dotenv";
import Stripe from "stripe";
import { setTimeout } from 'node:timers/promises';
import { Connection } from "jsforce";

const initialized = false;

const init = () => {
  if (initialized) {
    return;
  }

  dotenv.config({quiet: true});
}

const fromEnv = (name: string) => {
  const val: string | undefined = process.env[name];
  if (!val) {
    throw new Error(`${name} missing from environemnt, add it to .env?`);
  }
  return val;
};


export const connectStripe = () => {
  init();

  return new Stripe(fromEnv("STRIPE_KEY"), {
    telemetry: false,
  });
}

export const connectSalesforce = async () => {
  init();

  const sf = new Connection({
    loginUrl: 'https://arochausa.my.salesforce.com',
    oauth2: {
      clientId: fromEnv("SF_ID"),
      clientSecret: fromEnv("SF_KEY"),
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

  return sf;
}

export type StripeConnection = ReturnType<typeof connectStripe>;
export type SalesforceConnection = Awaited<ReturnType<typeof connectSalesforce>>;

export const stripeGetSubs = async (stripe: StripeConnection, ids: string[], params?: Stripe.SubscriptionRetrieveParams) => {
  const CHUNK = 12;
  const subs: Stripe.Subscription[] = [];

  for (let i=0; i<ids.length; i+=CHUNK) {
    if (i > 0) {
      await setTimeout(100);
    }
    const temp = await(Promise.all(ids.slice(i,i+CHUNK).map(id =>
      stripe.subscriptions.retrieve(id, params)
    )));
    subs.push(...temp);
  }

  return subs;
};

export const sfEmailsToContacts = async (sf: SalesforceConnection, emails: string[]) => {
  const sfChunk = 50;
  const uniqueEmails = [...new Set(emails.filter(email => !!email))];
 
  const fields = [
    "Email",
    "npe01__HomeEmail__c",
    "npe01__WorkEmail__c",
    "npe01__AlternateEmail__c"
  ];

  const emailToContactMap = new Map<string,string>();

  for (let i = 0; i < uniqueEmails.length; i += sfChunk) {
    // Query SF for contacts that have the given emails.
    const emailStr = uniqueEmails.slice(i, i + sfChunk).map(email => `'${email}'`).join(",");
    const soql = `
      SELECT Id, ${fields.join(", ")}
      FROM Contact
      WHERE ${fields.map(field => field + " IN " + emailStr).join(" OR ")}
      LIMIT 2000
    `;
    console.log(soql); //DEBUG_161
    const res = await sf.query(soql);

    // Build mapping from emails to Salesforce contacts.
    res.records.forEach(record => {
      for(const field of fields) {
        if (record[field] && record.Id) {
          emailToContactMap.set(record[field].toLocaleLowerCase(), record.Id);
        }
      }
    });
  }

  return emails.map(email =>
    (email && emailToContactMap.get(email.toLocaleLowerCase())) || "UNKNOWN"
  );
}