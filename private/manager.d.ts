export type ManagerEmailMap = Record<string, string>;

export type ManagerSubInfo = {
  [key: string]: {
    greeting?: string,
    hasPaypal?: boolean,
    hasStripe?: boolean,
    subs: {
      designation: string,
      amount: string,
      frequency: "month" | "quarter" | "year",
      since: string,
      processorId: string,
      processorDonorUrl?: string,
    }[],
  }
};