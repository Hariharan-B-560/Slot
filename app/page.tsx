import { redirect } from "next/navigation";

export default function Home() {
  // v1 has exactly one screen so far: teacher availability.
  redirect("/availability");
}
