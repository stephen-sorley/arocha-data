#!/usr/bin/env node

import { cmGetSubs } from "./lib/utils.ts"

const start = performance.now();
const emailToSubsMap = await cmGetSubs("Active");
console.error(`\nRetreived ${emailToSubsMap.size} active CM subscribers in ${(performance.now() - start)/1000}s`);

type Subscription = {
  listId: string,
  listName: string,
  joinedAs: string,
  joinedOn: string,
}

type Subscriber = {
  email: string,
  lists: Subscription[];
};

const subscribers: Subscriber[] = [];
for (const [email, subs] of emailToSubsMap) {
  const subscriptions: Subscription[] = [];

  for (const sub of subs) {
    subscriptions.push({
      listId: sub.list.ListID,
      listName: sub.list.Name,
      joinedAs: sub.sub.Name || "[Not Provided]",
      joinedOn: sub.sub.ListJoinedDate
    });
  }

  subscribers.push({
    email: email,
    lists: subscriptions,
  });
}

console.log(JSON.stringify(subscribers, null, 2));