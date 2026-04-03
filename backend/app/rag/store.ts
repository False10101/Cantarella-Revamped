import index from "./client";
import embed from "./embed";
import { db } from "../../db";
import { memories } from "../../db/schema";
import { randomUUID } from "crypto";

const storeMemory = async (content: string, category: string, userId: number) => {
    const currentDate = new Date().toLocaleDateString('en-US', {
        timeZone: 'Asia/Bangkok',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    const timeAwareContent = `[Stored on ${currentDate}] ${content}`;
    const vectorId = randomUUID();

    const vector = await embed(timeAwareContent);

    await db.transaction(async (tx) => {
        await tx.insert(memories).values({
            content: timeAwareContent,
            category,
            userId,
            vectorId
        });
    });

    await index.upsert({
        id: vectorId,
        vector,
        metadata: { timeAwareContent, userId }
    });

    return vectorId;
}

export default storeMemory;