const http=require("http");
const fs=require("fs");
const path=require("path");
const PORT=process.env.PORT||3000;
const ROOT=path.join(__dirname,"assets");
const MIME={".webp":"image/webp",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const CARD_MAP={
  ucl:[0,0],bundesliga:[1,0],premier:[2,0],laliga:[3,0],
  seriea:[0,1],ligue1:[1,1],europa:[2,1],conference:[3,1],
  facup:[0,2],coppa_italia:[1,2],dfbpokal:[2,2],carabao:[3,2]
};
function cardSvg(key){
  const pos=CARD_MAP[key];
  if(!pos)return null;
  const [col,row]=pos;
  const x=-(col*360),y=-(row*160);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160" viewBox="0 0 360 160">'+
    '<image href="/assets/competition-sprite.webp" x="'+x+'" y="'+y+'" width="1440" height="480" preserveAspectRatio="none"/>'+
    '</svg>';
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/"||url.pathname==="/health"){
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*"});
    return res.end(JSON.stringify({ok:true,service:"content-hub-assets",competitions:Object.keys(CARD_MAP)}));
  }
  if(url.pathname==="/manifest.json"){
    const manifest={sprite:"/assets/competition-sprite.webp",grid:{columns:4,rows:3},competitions:CARD_MAP};
    res.writeHead(200,{"content-type":"application/json","access-control-allow-origin":"*","cache-control":"public,max-age=300"});
    return res.end(JSON.stringify(manifest));
  }
  const match=url.pathname.match(/^\/competitions\/([a-z0-9_]+)\.svg$/);
  if(match){
    const svg=cardSvg(match[1]);
    if(!svg){res.writeHead(404,{"access-control-allow-origin":"*"});return res.end("Not found");}
    res.writeHead(200,{
      "content-type":"image/svg+xml; charset=utf-8",
      "access-control-allow-origin":"*",
      "cache-control":"public,max-age=86400"
    });
    return res.end(svg);
  }
  if(!url.pathname.startsWith("/assets/")){res.writeHead(404,{"access-control-allow-origin":"*"});return res.end("Not found");}
  const file=path.normalize(path.join(__dirname,url.pathname));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{"access-control-allow-origin":"*"});return res.end("Not found");}
    res.writeHead(200,{
      "content-type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream",
      "access-control-allow-origin":"*",
      "cache-control":"public,max-age=31536000,immutable"
    });
    res.end(data);
  });
});
server.listen(PORT,"0.0.0.0",()=>console.log("Content Hub Asset Host listening on "+PORT));
