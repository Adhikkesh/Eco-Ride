"use client";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { backendUrl } from "../../config";

export default function Onboarding() {
  const router = useRouter();

  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const response = await fetch(`${backendUrl}/api/v1/user`, {
      body: JSON.stringify({
        name: user.displayName,
        role: "driver",
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      router.push("/dashboard");
    }
  };

  return (
    <div>
      <h1>Welcome! Complete your profile</h1>
      <button type="button" onClick={handleSubmit}>
        Complete Signup
      </button>
    </div>
  );
}
