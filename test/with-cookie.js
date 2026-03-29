import untube from "../dist/index.js";

const data = await untube.getVideoInfo("dQw4w9WgXcQ", { cookies: './cookies.txt' }).catch(err => {
    console.log(err.message);
})

console.log(data);
