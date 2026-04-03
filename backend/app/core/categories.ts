export const MEMORY_CATEGORIES = [
  'personal',      // name, age, location, physical traits
  'work',          // job, projects, skills, career goals
  'preferences',   // likes, dislikes, habits
  'relationships', // friends, family, social context
  'goals',         // short/long-term plans and aspirations
  'events',        // things that happened, appointments, milestones
] as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[number];