import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../src/prompts/SOUL.md", import.meta.url);
const destinationDirectory = new URL("../dist/src/prompts/", import.meta.url);
const destination = new URL("SOUL.md", destinationDirectory);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
