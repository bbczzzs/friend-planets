// After `friendsdk build`: bundle the online bridge (host/net.ts) and load it in the host page.
// The SDK keeps the game frame offline; the host page introduces players peer to peer.
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
const out = process.argv[2] || "dist";
await esbuild.build({ entryPoints: ["host/net.ts"], bundle: true, format: "iife", target: "es2020", minify: true, outfile: path.join(out, "net.js"), legalComments: "none" });
const index = path.join(out, "index.html");
let html = fs.readFileSync(index, "utf8");
if (!html.includes("net.js")) html = html.replace("</body>", '<script src="./net.js"></script></body>');
fs.writeFileSync(index, html);
console.log("online bridge added to", index);
