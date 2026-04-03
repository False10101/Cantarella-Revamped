import 'dotenv/config'
import OpenAI from "openai";

const openai = new OpenAI();

const embed = async (input: string) => {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input,
    });
    return response.data[0].embedding;
}

export default embed;