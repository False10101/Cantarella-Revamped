import { Router } from "express";
import { messageHistory, sendMessage } from "../controllers/messageController";

const messageRouter = Router();

messageRouter.post("/send", sendMessage);
messageRouter.get("/history", messageHistory);

export default messageRouter;