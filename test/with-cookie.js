import untube from "../dist/index.js";

const data = await untube.getVideoInfo("TGXcNTSdQpM", { cookie: './cookies.txt' }).catch(err => {
    console.log(err.message);
})

console.log(data);
