import { Index } from "@upstash/vector";
import 'dotenv/config';

const index = Index.fromEnv();

export default index;