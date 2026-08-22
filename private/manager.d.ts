export type ManagerEmailMap = Record<string, string>;

export type ManagerSubInfo = {
  [key: string]: {
      designation: string,
      amount: string,
      frequency: "Month" | "Quarter" | "Year",
      since: string,
      contactId: string,
      processorId: string,
  }[],
};