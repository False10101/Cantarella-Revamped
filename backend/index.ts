import express from 'express';
import "dotenv/config";
import {JWTCheck, attachUser} from './app/middleware/auth';
import messageRouter from './app/routers/messageRouter';

const app = express();

app.use(express.json());
app.use(JWTCheck);
app.use(attachUser);


const port = process.env.SERVER_PORT || 3005;

app.get('/ping', function (req, res) {
    res.status(200).send("Ping Recieved");
});

app.use('/api/message', messageRouter);

app.listen(port, ()=>{
    console.log(`Server running on PORT : ${port}`);
})