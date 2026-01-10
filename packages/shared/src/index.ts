export const RIDE_STATUS = {
  SEARCHING: "SEARCHING",
  MATCHED: "MATCHED",
  COMPLETED: "COMPLETED"
} as const;

export interface User {
  uid: string;
  role: "rider" | "driver";
}
