// Plain constants (not a "use server" module) so components and server actions
// can share the student status list.
export const STUDENT_STATUSES = ["lead", "demo_scheduled", "enrolled", "dropped"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
