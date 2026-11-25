import { main } from "../../src/main";

const seed = process.argv[2];
if (!seed) throw new Error("Expected an ordinary acceptance seed");

await main({ matchSeedSource: () => seed });
