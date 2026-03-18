import { Router } from "express";
import { sendMessage } from "../controllers/messageController";

const messageRouter = Router();

messageRouter.post("/send", sendMessage);

export default messageRouter;