import untube from "../dist/index.js";

async function test() {
    console.log("Searching YT Music for 'jkt48'...");
    try {
        const results = await untube.ytmusic("jkt48");
        console.log(`Found ${results.length} results.`);
        if (results.length > 0) {
            console.log("Top 3 results:");
            console.log(results.slice(0, 3));
        } else {
            console.log("No results found.");
        }
    } catch (err) {
        console.error("Error:", err.message);
    }
}

test();
