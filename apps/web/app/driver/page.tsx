"use client";

import DriverLiveMap from "@/components/maps/DriverLiveMap";

// Prevent static generation
export const dynamic = "force-dynamic";

export default function DriverPage(): React.ReactNode {
  return <DriverLiveMap />;
}
