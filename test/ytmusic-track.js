import untube from "../dist/index.js";

async function testTrackInfo() {
    console.log("--- Testing untube.ytmusic.getTrackInfo ---");
    const videoIdOrUrl = "https://music.youtube.com/watch?v=dQw4w9WgXcQ";

    try {
        const info = await untube.ytmusic.getTrackInfo(videoIdOrUrl);
        console.log("Track Info Result:");
        console.log("ID:", info.id);
        console.log("Title:", info.title);
        console.log("Artist:", info.artist);
        console.log("Album:", info.album || "(No Album)");
        console.log("Duration:", info.duration, "seconds (", info.duration_string, ")");
        console.log("Thumbnail:", info.thumbnail);
        console.log("Webpage URL:", info.webpage_url);
        console.log("Total Thumbnails:", info.thumbnails.length);
        console.log("--- Test Completed Successfully ---");
    } catch (err) {
        console.error("Test Failed:", err);
    }
}

testTrackInfo();
