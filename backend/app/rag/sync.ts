import searchMemory from "./search";
import storeMemory from "./store";
import { deleteMemory, updateMemory } from "./manipulate";
import memoryController from "../services/memory";
import { MEMORY_CATEGORIES, MemoryCategory } from "../core/categories";

const DEFAULT_CATEGORY: MemoryCategory = 'personal';

const syncMemory = async (content: string, AIresponse: string, userId: number) => {
    const relevant = await searchMemory(content, userId);

    const action = await memoryController(content, AIresponse, relevant);

    if (action.startsWith('ADD:')) {
        const match = action.match(/ADD:(\w+):\s*([\s\S]+)/i);
        if (match) {
            const rawCategory = match[1].toLowerCase();
            const category: MemoryCategory = MEMORY_CATEGORIES.includes(rawCategory as MemoryCategory)
                ? rawCategory as MemoryCategory
                : DEFAULT_CATEGORY;
            const fact = match[2].trim();
            await storeMemory(fact, category, userId);
        } else {
            console.warn("syncMemory: ADD action failed to parse:", action);
        }
    }

    else if (action.startsWith("UPDATE:")) {
        const match = action.match(/UPDATE:\s*(\d+)\s*([\s\S]*)/i);
        if (match) {
            const id = parseInt(match[1]);
            const newText = match[2].trim();
            const mem = relevant.find(m => m.id === id);
            if (mem) await updateMemory(id, mem.vectorId!, newText, userId);
        } else {
            console.warn("syncMemory: UPDATE action regex failed to parse:", action);
        }
    }

    else if (action.startsWith("DELETE:")) {
        const match = action.match(/DELETE:\s*(\d+)/i);
        if (match) {
            const id = parseInt(match[1]);
            const mem = relevant.find(m => m.id === id);
            if (mem) await deleteMemory(id, mem.vectorId!);
        } else {
            console.warn("syncMemory: DELETE action failed to parse:", action);
        }
    }

    else if (action !== "NONE") {
        console.warn("syncMemory: unrecognised action from memoryController:", action);
    }
}

export default syncMemory;