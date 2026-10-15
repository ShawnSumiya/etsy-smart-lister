import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import HomeClient from "./home-client";
import { SESSION_COOKIE } from "@/lib/license/crypto";
import { requireLicenseToken } from "@/lib/license/guard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const access = await requireLicenseToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!access.ok) {
    redirect("/login");
  }

  return <HomeClient />;
}


