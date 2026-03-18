import pipeline from "../core/pipeline";
import extractMemory from "../rag/extract";
import storeMemory from "../rag/store";

export const sendMessage = async (req: any, res: any) => {

    try {
        const { content, platform } = req.body;
        const userId = req.user.id;

        const response = await pipeline({
            content, platform, userId
        })

        res.status(200).json({ response: response });

        try {
            const memoryExtract = await extractMemory(content, response!);
            if (memoryExtract !== 'NONE') {
                await storeMemory(memoryExtract, 'general', userId);
            }
        } catch (memoryError) {
            console.log('Memory extraction failed:', memoryError);
        }


        return
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Something went wrong' });
    }
}