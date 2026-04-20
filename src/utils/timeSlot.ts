export type TimeSlot = "morning" | "noon" | "evening" | "night" | "late_night";

export const TIME_SLOT_CHOICES = [
  { name: "朝 (6:00〜11:00)", value: "morning" },
  { name: "昼 (11:00〜15:00)", value: "noon" },
  { name: "夕方 (15:00〜19:00)", value: "evening" },
  { name: "夜 (19:00〜24:00)", value: "night" },
  { name: "深夜 (0:00〜6:00)", value: "late_night" }
] as const satisfies { name: string; value: TimeSlot }[];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  morning: "朝",
  noon: "昼",
  evening: "夕方",
  night: "夜",
  late_night: "深夜"
};

export const getJstTimeSlot = (): TimeSlot => {
  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour >= 6 && jstHour < 11) return "morning";
  if (jstHour >= 11 && jstHour < 15) return "noon";
  if (jstHour >= 15 && jstHour < 19) return "evening";
  if (jstHour >= 19) return "night";
  return "late_night";
};
