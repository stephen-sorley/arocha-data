export type ManagerEmailMap = Record<string, string>;

export type ManagerSubInfo = {
  [key: string]: {
      designation: string,
      amount: string,
      frequency: "month" | "quarter" | "year",
      since: string,
      contactId: string,
      processorId: string,
      processor: "cnp" | "paypal" | "stripe",
      status?: "active" | "inactive" | "unknown",
  }[],
};