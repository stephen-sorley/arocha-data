/**
 * Salesforce
 * 
 * Convert list of emails to list of Salesforce contacts.
 * 
 * See utils.ts for instructions on what environment variables this needs set.
 */

import { Connection } from "jsforce";

import { init, fromEnv } from "./utils.ts";
import { emailNorm } from "./email.ts";

export type SalesforceConnection = Awaited<ReturnType<typeof sfConnect>>;

export const sfConnect = async () => {
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

export type SfContactRecord = {
  id: string,
  first?: string,
  last?: string,
  emails: string[],
}

export const sfEmailFields = [
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
  "npe01__AlternateEmail__c"
];

export type HouseholdEmails = {
  account: string,
  emails: Set<string>,
}

export const sfEmailsToContacts = async (sf: SalesforceConnection, emails: string[]) => {
  const sfChunk = 50;
  const normEmails = emails.map(email => emailNorm(email));
  const uniqueEmails = [...new Set(normEmails.filter(email => !!email))];
 
  const emailToContactMap = new Map<string, SfContactRecord>();

  for (let i = 0; i < uniqueEmails.length; i += sfChunk) {
    // Query SF for contacts that have the given emails.
    const emailStr = "(" + uniqueEmails.slice(i, i + sfChunk).map(email => `'${email}'`).join(",") + ")";
    const soql = `
      SELECT Id, ${sfEmailFields.join(", ")}, FirstName, LastName
      FROM Contact
      WHERE ${sfEmailFields.map(efield => efield + " IN " + emailStr).join(" OR ")}
      LIMIT 2000
    `;
    const res = await sf.query(soql);

    // Build mapping from emails to Salesforce contacts.
    res.records.forEach(record => {
      for(const efield of sfEmailFields) {
        const nemail = emailNorm(record[efield]);
        if (nemail && record.Id) {
          emailToContactMap.set(nemail, {
            id: record.Id,
            first: record.FirstName,
            last: record.LastName,
            emails: sfEmailFields.map(efield => emailNorm(record[efield])).filter(nemail => !!nemail) as string[],
          });
        }
      }
    });
  }

  return normEmails.map(nemail => emailToContactMap.get(nemail || ""));
}
