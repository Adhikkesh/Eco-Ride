"use client";

import RiderMap from "@/components/maps/RiderMap";

// Prevent static generation
export const dynamic = "force-dynamic";

export default function RiderPage(): React.ReactNode {
  return <RiderMap />;
}
