import index from "./client";
import { db } from "../../db";
import { memories } from "../../db/schema";
import { eq } from "drizzle-orm";
import embed from "./embed";

export const deleteMemory = async (memoryId: number, vectorId: string) => {
    // DB first
    await db.delete(memories).where(eq(memories.id, memoryId));

    // Vector after — if this fails, the row is gone but the vector is orphaned
    // Acceptable tradeoff vs. the reverse (ghost DB rows)
    await index.delete([vectorId]);
};

export const updateMemory = async (
    memoryId: number,
    vectorId: string,
    newContent: string,
    userId: number
) => {
    const currentDate = new Date().toLocaleDateString('en-US', {
        timeZone: 'Asia/Bangkok',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    const timeAwareContent = `[Updated on ${currentDate}] ${newContent}`;

    // Embed before touching DB
    const vector = await embed(timeAwareContent);

    // DB first
    await db.update(memories)
        .set({ content: timeAwareContent })
        .where(eq(memories.id, memoryId));

    // Vector after — consistent metadata key with storeMemory
    await index.upsert({
        id: vectorId,
        vector,
        metadata: { timeAwareContent, userId }
    });
};