export const RIDE_STATUS = {
  COMPLETED: "COMPLETED",
  MATCHED: "MATCHED",
  SEARCHING: "SEARCHING",
} as const;

export interface User {
  uid: string;
  role: "rider" | "driver";
}
