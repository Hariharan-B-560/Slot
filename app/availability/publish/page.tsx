import { redirect } from "next/navigation";

// Publishing availability now happens directly on the grid — click an empty
// cell (or drag-select) to publish. This route redirects for old links.
export default function PublishRedirect() {
  redirect("/availability");
}
