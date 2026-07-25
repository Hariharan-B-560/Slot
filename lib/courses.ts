// The four courses. All are 1-teacher-1-student with identical mechanics —
// "course" is a display label only. NEVER branch scheduling / duration /
// capacity on it. Values mirror the public.course_type enum.

export const COURSES = ["basic", "speaking", "combo", "speaking_partner"] as const;
export type Course = (typeof COURSES)[number];

export const COURSE_LABELS: Record<Course, string> = {
  basic: "Basic",
  speaking: "Speaking",
  combo: "Combo",
  speaking_partner: "Speaking Partner",
};

/** Human label for a course value; falls back to the raw string if unknown. */
export function courseLabel(course: string | null | undefined): string {
  if (!course) return "";
  return (COURSE_LABELS as Record<string, string>)[course] ?? course;
}

/**
 * value → label map for base-ui `<Select items={...}>` so the trigger shows the
 * course NAME, not the raw enum value.
 */
export const COURSE_ITEMS: Record<string, string> = COURSE_LABELS;
