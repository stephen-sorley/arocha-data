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
  account: string,
  first?: string,
  last?: string,
}

export const sfEmailFields = [
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
  "npe01__AlternateEmail__c"
];

export const sfEmailsToContacts = async (sf: SalesforceConnection, emails: string[]) => {
  const CHUNK = 50;
  const normEmails = emails.map(email => emailNorm(email));
  const uniqueEmails = [...new Set(normEmails.filter(email => !!email))];
 
  const emailToContactMap = new Map<string, SfContactRecord>();
  const accountToEmailsMap = new Map<string, Set<string>>();

  const emailLists: string[] = [];
  for (let i = 0; i < uniqueEmails.length; i += CHUNK) {
    emailLists.push(
      `(${uniqueEmails.slice(i, i + CHUNK).map(email => `'${email}'`).join(",")})`
    );
  }

  await Promise.all(emailLists.map(async (emailList) => {
    // Query SF for contacts that have the given emails.
    const soql =
     `SELECT Id,AccountId,FirstName,LastName,${sfEmailFields.join(",")} FROM Contact
      WHERE ${sfEmailFields.map(efield => efield + " IN " + emailList).join(" OR ")}`
    ;
    const res = await sf.query(soql);

    // Build mapping from emails to Salesforce contacts.
    const accountIds = new Set<string>();
    res.records.forEach(record => {
      if (!record.Id || !record.AccountId) return;

      // Make a list of unique accounts that we've seen.
      accountIds.add(record.AccountId);

      const contactEmails = sfEmailFields.map(efield => emailNorm(record[efield])).filter(nemail => !!nemail) as string[];

      // Build mapping from email to contact details.
      for (const email of contactEmails) {
        emailToContactMap.set(email, {
          id: record.Id,
          account: record.AccountId,
          first: record.FirstName,
          last: record.LastName,
        });
      }
    });

    const acctSoql =
     `SELECT Id,AccountId,${sfEmailFields.join(",")} FROM Contact
      WHERE AccountId IN ('${[...accountIds].join("','")}')`
    ;
    return sf.query(acctSoql).then((res) => {
      res.records.forEach(record => {
        // Upsert entry in accountToEmailsMap.
        const emailSet = accountToEmailsMap.get(record.AccountId) ?? new Set<string>();
        if (emailSet.size === 0) {
          accountToEmailsMap.set(record.AccountId, emailSet);
        }

        for (const efield of sfEmailFields) {
          const nemail = emailNorm(record[efield]);
          if (nemail) {
            emailSet.add(nemail);
          }
        }
      });
    });
  }));

  return {
    emailToContact: emailToContactMap,
    accountToEmails: accountToEmailsMap,
  };
}
