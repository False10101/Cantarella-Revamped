import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { memories } from "../../db/schema";
import index from "./client";
import embed from "./embed";

const searchMemory = async(query : string, userId :number, topK = 5) =>{
    const vector = await embed(query);

    const results = await index.query({
        vector,
        topK,
        includeMetadata: true,
        filter: `userId = ${userId}`
    })

    const vectorIds = results.map(r => String(r.id))

    if(vectorIds.length < 1) return [];

    const memoryRows = await db.select().from(memories).where(inArray(memories.vectorId, vectorIds));

    return memoryRows;
}

export default searchMemory;