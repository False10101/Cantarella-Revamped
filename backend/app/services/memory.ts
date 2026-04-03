import openai from "../services/openai"
import { MEMORY_CATEGORIES } from "../core/categories";


const memoryController = async (userMessage: string, AIresponse: string, currentMemories: any[]) => {
    const memoryContext = currentMemories.map(m => `[ID: ${m.id}] ${m.content}`).join("\n");
    const categoryList = MEMORY_CATEGORIES.join(', ');


    const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
            {
                role: 'system',
                content: `You manage the user's long-term memory. 
                Current related memories:
                ${memoryContext || "None"}

                Decide the best action based on the conversation:
                - ADD:[category]: "new fact"  (If it's brand new info worth remembering)
                - UPDATE: [ID] "updated fact" (If existing info changed or was corrected)
                - DELETE: [ID] (If info is proven false or user says forget it)
                - NONE (If nothing important)

                Category must be one of: ${categoryList}

                Respond ONLY with the action string.

                Examples:
                ADD:work: User is interning at a fintech company called CARRO.
                ADD:goals: User wants to relocate to Germany after graduation.
                UPDATE: 12 User's nickname is now Issac not Ian.
                DELETE: 7`
            },
            {
                role: 'user',
                content: `User said: ${userMessage}\nAssistant said: ${AIresponse}`
            }
        ],
        temperature: 0.1
    });

    return completion.choices[0].message.content ?? 'NONE';
}

export default memoryController;