const http=require("http");
const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"public");
const types={".webp":"image/webp",".json":"application/json; charset=utf-8",".html":"text/html; charset=utf-8"};
http.createServer((req,res)=>{
 const raw=(req.url||"/").split("?")[0];
 const safe=raw==="/"?"/index.html":raw;
 const file=path.join(root,safe.replace(/^\/+/, ""));
 if(!file.startsWith(root)){res.writeHead(403);return res.end("Forbidden")}
 fs.readFile(file,(err,data)=>{
  if(err){res.writeHead(404,{"Access-Control-Allow-Origin":"*"});return res.end("Not found")}
  const ext=path.extname(file);
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":ext===".webp"?"public, max-age=31536000, immutable":"public, max-age=300","Access-Control-Allow-Origin":"*"});
  res.end(data);
 });
}).listen(process.env.PORT||3000,"0.0.0.0",()=>console.log("Content Hub Asset Host ready"));
