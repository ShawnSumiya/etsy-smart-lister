import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import HomeClient from "./home-client";

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session_token");

  if (!session) {
    redirect("/login");
  }

  return <HomeClient />;
}


