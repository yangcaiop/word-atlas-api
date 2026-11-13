import { z } from "zod";

export const DATASET_ID = "word-atlas-open";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().nonnegative().max(8.64e15);
const wordId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const card = z
  .object({
    due: timestamp,
    s: z.number().nonnegative().finite(),
    d: z.number().min(0).max(11),
    el: z.number().nonnegative().finite(),
    sd: z.number().nonnegative().finite(),
    ls: count,
    reps: count,
    lapses: count,
    st: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    last: timestamp.optional(),
    seen: timestamp,
  })
  .strict();
export const settingsSchema = z
  .object({
    accent: z.enum(["uk", "us"]),
    autoplay: z.boolean(),
    dailyNew: z.number().int().min(0).max(100),
    retention: z.number().min(0.7).max(0.97),
    theme: z.enum(["system", "light", "dark"]),
    sfx: z.boolean(),
    spell: z.boolean(),
    startLevel: z.number().int().min(0).max(5),
    ambience: z.enum([
      "off",
      "stars",
      "rain",
      "sea",
      "forest",
      "fire",
      "voyage",
      "cafe",
    ]),
    ambienceVolume: z.number().min(0).max(1),
    splash: z.boolean(),
  })
  .strict();
export const snapshotSchema = z
  .object({
    progress: z
      .object({
        version: z.literal(2),
        datasetId: z.literal(DATASET_ID),
        cards: z
          .record(wordId, card)
          .refine((v) => Object.keys(v).length <= 20000),
        bookmarks: z.array(wordId).max(20000),
        mistakes: z.array(wordId).max(300),
        days: z
          .record(
            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            z.object({ n: count, r: count, c: count, t: count }).strict(),
          )
          .refine((v) => Object.keys(v).length <= 20000),
        typing: z
          .array(
            z
              .object({
                at: timestamp,
                mode: z.enum(["word", "sentence", "dictation"]),
                items: count,
                wpm: z.number().min(0).max(400),
                accuracy: z.number().min(0).max(100),
              })
              .strict(),
          )
          .max(500),
        session: z.null(),
      })
      .strict(),
    settings: settingsSchema,
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export interface RemoteData {
  snapshot: Snapshot;
  revision: number;
  updatedAt: string;
}
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,32}$/),
  password: z.string().min(8).max(128),
});
export const uploadSchema = z
  .object({ baseRevision: count, snapshot: snapshotSchema })
  .strict();
