import untube from "../dist/index.js";

const data = await untube.getVideoInfo("TGXcNTSdQpM").catch(err=>{
    console.log(err.message);
})

console.log(data);
