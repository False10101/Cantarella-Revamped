import index from "./client";
import embed from "./embed";
import { db } from "../../db";
import { memories } from "../../db/schema";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

const storeMemory = async (content: string, category: string, userId: number) => {
    const vector = await embed(content);
    const vectorId = randomUUID();

    await db.transaction(async (tx) => {
        const inserted = await tx.insert(memories).values({
            content: content,
            category: category,
            userId: userId
        });

        const insertId = inserted.lastInsertId;

        await index.upsert({
            id: vectorId,
            vector,
            metadata: { content, userId }
        })

        await tx.update(memories).set({vectorId: vectorId}).where(eq(memories.id,Number(insertId)))
    })

    return vectorId
}

export default storeMemory;