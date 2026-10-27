// 前台渲染：仿 kingwrcy/moments 的朋友圈版面（封面头图 + 头像 + 单栏时间线），样式为自研实现。
import { escapeHtml as esc } from './markdown.js';
import { renderContent, excerptOf } from './richtext.js';
import { parseJsonSafe, VERSION } from './db.js';

export const CSS = `
:root{
  --bg:#f4f4f6; --card:#ffffff; --text:#1f2329; --sub:#8a8f98; --line:#e7e7ea; --line-strong:#c9ccd4;
  --accent:#576b95; --chip:#eef0f4; --shadow:0 1px 3px rgba(0,0,0,.05);
}
[data-theme="dark"]{
  --bg:#0c1425; --card:#16213a; --text:#e6ebf5; --sub:#93a3c0; --line:#263453; --line-strong:#3d4f78;
  --accent:#93b0e8; --chip:#1d2b47; --shadow:0 1px 3px rgba(2,6,18,.5);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
body{background-image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27278%27%20height%3D%27392%27%3E%3Ctext%20x%3D%27139%27%20y%3D%27106.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%231c2733%27%20fill-opacity%3D%270.055%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%20139%2098%29%27%3ETaoGe%3C%2Ftext%3E%3Ctext%20x%3D%270%27%20y%3D%27302.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%231c2733%27%20fill-opacity%3D%270.055%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%200%20294%29%27%3ETaoGe%3C%2Ftext%3E%3Ctext%20x%3D%27278%27%20y%3D%27302.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%231c2733%27%20fill-opacity%3D%270.055%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%20278%20294%29%27%3ETaoGe%3C%2Ftext%3E%3C%2Fsvg%3E");background-size:278px 392px}
[data-theme=dark] body{background-image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27278%27%20height%3D%27392%27%3E%3Ctext%20x%3D%27139%27%20y%3D%27106.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%23ffffff%27%20fill-opacity%3D%270.06%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%20139%2098%29%27%3ETaoGe%3C%2Ftext%3E%3Ctext%20x%3D%270%27%20y%3D%27302.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%23ffffff%27%20fill-opacity%3D%270.06%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%200%20294%29%27%3ETaoGe%3C%2Ftext%3E%3Ctext%20x%3D%27278%27%20y%3D%27302.4%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2730%27%20font-weight%3D%27700%27%20letter-spacing%3D%272%27%20fill%3D%27%23ffffff%27%20fill-opacity%3D%270.06%27%20text-anchor%3D%27middle%27%20transform%3D%27rotate%28-28%20278%20294%29%27%3ETaoGe%3C%2Ftext%3E%3C%2Fsvg%3E")}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:720px;margin:0 auto;padding:0 12px 40px}
.head-box{position:relative;background:var(--card);border-radius:16px 16px 0 0;box-shadow:var(--shadow);padding:0;margin-top:12px}
.cover{position:absolute;inset:0;background:#3a3f4a center/cover no-repeat;border-radius:16px 16px 0 0;z-index:0}
.cover::after{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(to bottom, rgba(10,12,20,0) 50%, rgba(10,12,20,.45) 100%)}
.head-inner{position:relative;z-index:1;padding:0 16px 20px}
.hero{position:relative;height:238px}
.hero .site-name{position:absolute;right:96px;bottom:-21px;color:#fff;font-size:19px;font-weight:600;line-height:1.25;
  text-shadow:0 1px 4px rgba(0,0,0,.55)}
.hero .avatar{position:absolute;right:16px;bottom:-22px;width:68px;height:68px;border-radius:10px;
  border:3px solid #fff;background:#cfd4dd center/cover no-repeat;box-shadow:var(--shadow)}
.hero .avatar-fallback{display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;background:#7a8494}
.head-meta{margin:28px 6px 0;padding-bottom:3px;text-align:right;color:#fff;font-size:13px;min-height:18px;border-bottom:1px solid rgba(255,255,255,.35);text-shadow:0 1px 3px rgba(0,0,0,.5)}
.head-box .chip,.head-box .icon-btn{background:none;border:none;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55)}
.head-box .chip.on{background:none;color:#fff;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.theme-btn{position:absolute;top:10px;right:10px;z-index:6;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(15,23,42,.35);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.theme-btn svg{width:19px;height:19px}
.theme-btn .ic-sun{display:none}
[data-theme="dark"] .theme-btn .ic-sun{display:block}
[data-theme="dark"] .theme-btn .ic-moon{display:none}
[data-theme="dark"] .head-box .chip,[data-theme="dark"] .head-box .icon-btn{background:none;border:none;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55)}
[data-theme="dark"] .head-box .chip.on{background:none;color:#fff;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.toolbar{display:flex;align-items:center;gap:8px;margin:10px 2px 2px;flex-wrap:wrap}
.memo-sep{border-top:1px solid var(--line-strong);margin:4px 0}
.files-gated{border:1px dashed var(--line-strong);border-radius:8px;padding:10px 12px;margin:8px 0 4px;max-width:460px;color:var(--sub);font-size:13px}
.files-gated a{color:var(--accent)}
.file-card{display:flex;gap:9px;align-items:center;padding:4px 0;margin:6px 0 2px;max-width:460px;color:var(--text);font-size:14px}
.file-ico{flex:0 0 21px;width:21px;height:21px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:8px;font-weight:700;letter-spacing:0}
.file-meta{min-width:0}
.file-name{font-weight:600;word-break:break-all}
.file-sub{display:block;font-size:12px;color:var(--sub);margin-top:1px}
.chip{display:inline-block;padding:5px 6px;background:none;color:var(--text2);
  font-size:13px;border:none}
.chip.on{background:none;color:var(--accent);font-weight:700}
[data-theme="dark"] .chip.on{background:none;color:#93b0e8}
.toolbar .spacer{flex:1}
.icon-btn{background:none;border:none;padding:5px 6px;
  font-size:13px;color:var(--text2);cursor:pointer}
.tb-btn{display:inline-flex;align-items:center;justify-content:center;padding:5px 6px;color:var(--text2);background:none;border:none;cursor:pointer}
.tb-btn svg{width:19px;height:19px}
.tb-btn.on{color:var(--accent)}
.head-box .tb-btn{color:#fff}
.head-box .tb-btn svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.head-box .tb-btn.on{color:#fff;box-shadow:inset 0 -2px 0 #fff}
[data-theme="dark"] .head-box .tb-btn{color:#fff}
[data-theme="dark"] .head-box .tb-btn.on{color:#fff;box-shadow:inset 0 -2px 0 #fff}
.feed-box{position:relative;z-index:2;background:var(--card);border-radius:0 0 16px 16px;box-shadow:0 -8px 22px rgba(27,35,51,.10), var(--shadow);border-top:1px solid var(--line-strong);padding:8px 16px;margin:-14px 0 0}
.memo{background:transparent;border-radius:0;box-shadow:none;padding:12px 0 8px;margin:0}
.memo-head{display:flex;gap:10px}
.memo-head .m-avatar{flex:0 0 42px;width:42px;height:42px;border-radius:8px;background:#cfd4dd center/cover no-repeat}
.memo-head .m-avatar-fallback{display:flex;align-items:center;justify-content:center;color:#fff;background:#7a8494;font-size:18px}
.m-nick{color:var(--accent);font-weight:600;font-size:15px}
.m-body{margin-left:52px}
.m-title{font-size:17px;font-weight:700;line-height:1.4;margin:0 0 6px;color:var(--text)}
.m-content{font-size:15px;line-height:1.65;word-break:break-word}
.m-content p{margin:6px 0}
.m-content img{max-width:100%;border-radius:8px}
.m-content pre{background:var(--chip);padding:10px;border-radius:8px;overflow:auto;font-size:13px}
.m-content code{background:var(--chip);padding:1px 5px;border-radius:4px;font-size:13px}
.m-content pre code{background:none;padding:0}
.m-content blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid var(--line);color:var(--sub)}
.m-content a{text-decoration:underline}
.grid{display:grid;gap:6px;margin:8px 0 4px;max-width:420px}
.grid img,.grid video{width:100%;height:100%;object-fit:cover;border-radius:6px;display:block;aspect-ratio:1/1}
.grid.g1{max-width:360px}
.grid.g1 img,.grid.g1 video{aspect-ratio:4/3}
.grid img{cursor:zoom-in}
.m-content img{width:100%;height:240px;object-fit:cover;display:block;margin:6px 0;cursor:zoom-in}
.lightbox{position:fixed;inset:0;background:rgba(6,10,22,.92);display:none;align-items:center;justify-content:center;z-index:99;cursor:zoom-out}
.lightbox.open{display:flex}
.lightbox img{max-width:94vw;max-height:92vh;object-fit:contain;border-radius:4px}
.grid.g2,.grid.g4{grid-template-columns:repeat(2,1fr);max-width:340px}
.grid.g3,.grid.g5,.grid.g6,.grid.g7,.grid.g8,.grid.g9{grid-template-columns:repeat(3,1fr)}
.ext{margin:8px 0 4px;border:1px solid var(--line);border-radius:10px;overflow:hidden;max-width:460px}
.ext iframe{width:100%;aspect-ratio:16/9;border:0;display:block}
.ext-vertical{max-width:460px;width:fit-content}
.dy-scale{position:relative;overflow:hidden;margin:0 auto}
.dy-scale iframe{width:360px;height:640px;aspect-ratio:auto;display:block;border:0;transform-origin:0 0}
.vframe{position:relative;width:100%;max-width:460px;margin:8px 0 4px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#000}
.vframe video{width:100%;height:auto;max-height:480px;display:block;background:#000}
.ext audio{width:100%}
.ext-card{display:flex;gap:10px;padding:10px;align-items:center;background:var(--chip)}
.ext-card img{width:52px;height:70px;object-fit:cover;border-radius:5px}
.ext-card .t{font-weight:600;font-size:14px;color:var(--text)}
.ext-card .d{font-size:12px;color:var(--sub);margin-top:3px}
.tags{margin:8px 0 2px;display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:12px;color:var(--accent);border:1px solid var(--line);padding:2px 8px;border-radius:999px}
.m-foot{margin:10px 0 4px 52px;display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;color:var(--sub);font-size:13px}
.m-foot .time{color:var(--sub);white-space:nowrap}
.m-foot .spacer{flex:1}
.m-foot>a{white-space:nowrap}
.m-foot form{flex:none}
.act{background:none;border:0;color:var(--sub);font-size:13px;cursor:pointer;padding:2px 3px;white-space:nowrap;flex:none}
.act.liked{color:#e05252}
.cmt-box{margin:8px 0 6px 52px;border-radius:10px;padding:4px 2px;font-size:14px}
.cmt{padding:4px 0;border-bottom:1px dashed var(--line)}
.cmt:last-child{border-bottom:0}
.cmt .n{color:var(--accent);font-weight:600}
.cmt .when{color:var(--sub);font-size:12px;margin-left:6px}
.reply-btn{background:none;border:0;color:var(--sub);font-size:13px;cursor:pointer;margin-left:8px;padding:0;line-height:1}
a.reply-btn{display:inline-block;text-decoration:none}
.reply-btn.del{color:#e5484d}
.reply-ico{width:15px;height:15px;vertical-align:-2px}
[data-theme="dark"] .reply-ico{filter:invert(1)}
.cmt .at{color:var(--accent)}
.replies{margin:2px 0 4px 14px;padding-left:10px;border-left:2px solid var(--line)}
.cmt-lines{margin:6px 0 2px 52px;font-size:14px}
.cmt-rest{display:none}
.cmt-rest.open{display:block}
.cmt-line{padding:1px 0;word-break:break-word}
.cmt-line .n{color:var(--accent);font-weight:600}
.cmt-line .at{color:var(--accent)}
.cmt-more{display:inline-block;margin-top:3px;font-size:13px;color:var(--sub)}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line);margin-left:8px}
.btn-row{display:flex;align-items:center;gap:0}
.cmt-form textarea{min-height:76px}
.emoji-toggle{margin-left:auto;background:transparent;border:1px solid var(--line);border-radius:999px;width:26px;height:26px;font-size:14px;cursor:pointer;line-height:1;padding:0}
.ao-check{display:flex;align-items:center;gap:4px;font-size:13px;color:var(--sub);margin-left:12px;cursor:pointer;white-space:nowrap}
.cmt-form .ao-check input{width:auto;padding:0;margin:0}
.ao-tag{font-size:11px;color:var(--sub);border:1px solid var(--line);border-radius:6px;padding:0 5px;margin-left:6px;white-space:nowrap}
.ao-hidden{color:#d97706;font-weight:600}
.tb-link{font-size:13px;color:var(--sub);text-decoration:none;padding:6px 4px;white-space:nowrap}
.tb-link:hover{color:var(--text)}
.tb-user{font-size:13px;color:var(--text);padding:6px 2px;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis}
.head-box .tb-link,.head-box .tb-user{color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55)}
.head-box .tb-link:hover{color:#fff;text-decoration:underline}
.emoji-panel{display:none;flex-wrap:wrap;gap:2px;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:8px}
.emoji-panel.open{display:flex}
.emoji-panel .emo{background:none;border:0;font-size:16px;cursor:pointer;padding:2px 3px;border-radius:6px;line-height:1.2}
.emoji-panel .emo:hover{background:var(--card)}
.cmt-ava{width:20px;height:20px;border-radius:50%;vertical-align:-5px;margin-right:5px}
img.cmt-ava{object-fit:cover}
svg.cmt-ava{background:var(--chip)}
svg.cmt-ava .fg{fill:var(--sub)}
.cmt-form{margin:8px 0 6px 52px;display:none}
.cmt-form.open{display:block}
.cmt-form input,.cmt-form textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;
  background:var(--card);color:var(--text);font-size:14px;margin-bottom:8px;font-family:inherit}
.cmt-form .row{display:flex;gap:8px;align-items:flex-start}
.cmt-form .row input{flex:1}
.cmt-form img.cap{height:40px;border-radius:6px;cursor:pointer;border:1px solid var(--line)}
.btn{background:#1f2329;color:#fff;border:0;border-radius:8px;padding:8px 18px;font-size:14px;cursor:pointer}
[data-theme="dark"] .btn{background:#93b0e8;color:#0c1425}
.hint{font-size:12px;color:var(--sub)}
.pager{display:flex;gap:14px;justify-content:center;margin:22px 0 6px;font-size:14px}
.links-box{background:transparent;border-top:2px solid var(--line-strong);padding:14px 16px 10px;margin:10px -16px -8px}
.links-box h3{margin:0 0 8px;font-size:15px}
.links-box a{display:inline-block;margin:3px 10px 3px 0;font-size:14px}
.foot-note{text-align:center;color:var(--sub);font-size:12px;margin-top:26px;line-height:1.9}
.foot-note .admin-link{color:inherit;text-decoration:none;cursor:pointer}
.foot-gh{display:inline-flex;align-items:center;gap:4px;color:inherit;text-decoration:none;vertical-align:-2px}
.gh-ico{height:14px;width:auto;display:block}
[data-theme="dark"] .gh-ico{filter:invert(1)}
.foot-gh:hover{text-decoration:underline}
.foot-note .admin-link:hover{text-decoration:underline}
.marquee{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--line);font-size:14px;color:var(--text)}
.mq-ico{flex:none}
.mq-track{flex:1;overflow:hidden;white-space:nowrap}
.mq-text{display:inline-block;padding-left:100%;animation:mqscroll linear infinite;font-weight:700}
.marquee:hover .mq-text{animation-play-state:paused}
@keyframes mqscroll{from{transform:translateX(0)}to{transform:translateX(-100%)}}
.notice{background:#fff7e0;border:1px solid #f0dfa0;color:#6b5c14;border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}
[data-theme="dark"] .notice{background:#33300f;color:#e8d98a;border-color:#55501f}
.pin{color:#e0a52e;font-size:12px;margin-left:6px}
@media (max-width:560px){
  .hero{height:168px}
  .m-content img{height:200px}
  .m-body,.m-foot,.cmt-box,.cmt-form,.cmt-lines{margin-left:0}
  .memo-head .m-avatar{flex:0 0 26px;width:26px;height:26px;border-radius:7px;font-size:13px}
  .m-foot{flex-wrap:nowrap;gap:6px 7px;font-size:12.5px}
  .m-foot .act{font-size:12.5px;padding:2px 1px}
}
`;

export const JS = `
function toggleTheme(){
  var cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',cur);
  try{localStorage.setItem('mm_theme',cur)}catch(e){}
}
function toggleCmt(id){
  var f=document.getElementById('cmt-form-'+id);
  if(f){
    f.classList.toggle('open');
    var img=f.querySelector('img.cap');
    if(img && !img.getAttribute('src')) img.src='/captcha?t='+Date.now();
  }
}
function replyTo(btn, memoId, rootId){
  var name=btn.getAttribute('data-rname')||'';
  var wrap=document.getElementById('cmt-form-'+memoId);
  if(wrap){
    wrap.classList.add('open');
    var img=wrap.querySelector('img.cap');
    if(img && !img.getAttribute('src')) img.src='/captcha?t='+Date.now();
  }
  var form=document.querySelector('#cmt-form-'+memoId+' form');
  if(!form) return;
  form.querySelector('input[name=parent_id]').value=rootId;
  form.querySelector('input[name=reply_to]').value=name;
  document.getElementById('cancel-reply-'+memoId).style.display='';
  var ta=form.querySelector('textarea');
  ta.placeholder='回复 @'+name+' …';
  ta.focus();
  ta.scrollIntoView({behavior:'smooth', block:'center'});
}
function openLightbox(src){
  var lb=document.getElementById('lightbox');
  if(!lb) return;
  document.getElementById('lightbox-img').src=src;
  lb.classList.add('open');
}
function closeLightbox(){
  var lb=document.getElementById('lightbox');
  if(lb) lb.classList.remove('open');
}
document.addEventListener('click', function(e){
  var t=e.target;
  if(t && t.tagName==='IMG' && t.closest('.m-body') && !t.closest('a') && !t.closest('.ext-card')) openLightbox(t.src);
});
document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeLightbox(); });
// 抖音播放框：框大小固定（宽 327x 缩放、高以 380 为上限），不再等比——
// 实测播放器画面只占窗口左侧约 327 宽、约九成高，横向按 327 对齐框宽、纵向多拉 1/0.9 把画面撑满整框，多出的白边由 overflow 裁掉。
function fitDy(){
  document.querySelectorAll('.dy-scale').forEach(function(w){
    var f=w.querySelector('iframe'); if(!f) return;
    var avail=w.parentElement ? w.parentElement.clientWidth : 360;
    var s=Math.min(avail/360, 380/640);
    if(!(s>0)) return;
    f.style.transform='scale('+s+','+(s/0.9)+')';
    w.style.width=(327*s)+'px';
    w.style.height=(640*s)+'px';
  });
}
document.addEventListener('DOMContentLoaded', fitDy);
window.addEventListener('resize', fitDy);
window.addEventListener('load', fitDy);
// 从首页评论的回复图标跳进详情页时（?reply=顶层评论id&rname=昵称），自动展开评论框并预设回复对象
document.addEventListener('DOMContentLoaded', function(){
  var q=new URLSearchParams(location.search);
  var rid=q.get('reply'); if(!rid) return;
  var name=q.get('rname')||'';
  var wrap=document.querySelector('.cmt-form'); if(!wrap) return;
  var memoId=wrap.id.replace('cmt-form-','');
  wrap.classList.add('open');
  var capImg=wrap.querySelector('img.cap');
  if(capImg && !capImg.getAttribute('src')) capImg.src='/captcha?t='+Date.now();
  var form=wrap.querySelector('form'); if(!form) return;
  form.querySelector('input[name=parent_id]').value=rid;
  form.querySelector('input[name=reply_to]').value=name;
  var cancel=document.getElementById('cancel-reply-'+memoId);
  if(cancel) cancel.style.display='';
  var ta=form.querySelector('textarea');
  if(name) ta.placeholder='回复 @'+name+' …';
  var anchor=document.getElementById('comments');
  if(anchor) anchor.scrollIntoView({behavior:'smooth', block:'center'});
});
function toggleAllComments(memoId, el){
  var rest=document.getElementById('cmt-rest-'+memoId);
  if(!rest) return;
  var open=rest.classList.toggle('open');
  el.textContent=open?'收起评论':'共 '+el.getAttribute('data-total')+' 条评论，点击查看全部';
}
function toggleEmoji(memoId){
  document.getElementById('emoji-panel-'+memoId).classList.toggle('open');
}
function insertEmoji(memoId, btn){
  var form=document.querySelector('#cmt-form-'+memoId+' form');
  var ta=form.querySelector('textarea');
  var text=btn.textContent;
  var s=(typeof ta.selectionStart==='number')?ta.selectionStart:ta.value.length;
  var e=(typeof ta.selectionEnd==='number')?ta.selectionEnd:s;
  ta.value=ta.value.slice(0,s)+text+ta.value.slice(e);
  var pos=s+text.length;
  ta.focus();
  try{ ta.setSelectionRange(pos,pos); }catch(err){}
}
function cancelReply(memoId){
  var wrap=document.getElementById('cmt-form-'+memoId);
  if(wrap) wrap.classList.remove('open');
  var form=document.querySelector('#cmt-form-'+memoId+' form');
  if(!form) return;
  form.querySelector('input[name=parent_id]').value='0';
  form.querySelector('input[name=reply_to]').value='';
  document.getElementById('cancel-reply-'+memoId).style.display='none';
  var ta=form.querySelector('textarea');
  ta.placeholder=ta.getAttribute('data-ph')||'写下你的评论';
}
function refreshCap(img){ img.src='/captcha?t='+Date.now(); }
async function likeMemo(id,btn){
  try{
    var r=await fetch('/memo/'+id+'/like',{method:'POST'});
    var d=await r.json();
    if(d&&typeof d.likes==='number'){
      btn.querySelector('.lc').textContent=d.likes;
      btn.classList.toggle('liked',!!d.liked);
    }
  }catch(e){}
}
`;

export function timeAgo(ts) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  // 超过 24 小时：直接显示「月-日 时:分」（北京时间）
  const d = new Date(ts * 1000 + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const FILE_TYPES = {
  zip: ['ZIP', '#7c5cd6'], rar: ['ZIP', '#7c5cd6'], '7z': ['ZIP', '#7c5cd6'], tar: ['ZIP', '#7c5cd6'], gz: ['ZIP', '#7c5cd6'],
  pdf: ['PDF', '#d64545'],
  doc: ['DOC', '#3b78c3'], docx: ['DOC', '#3b78c3'],
  xls: ['XLS', '#3f9e4d'], xlsx: ['XLS', '#3f9e4d'], csv: ['XLS', '#3f9e4d'],
  ppt: ['PPT', '#d97c2b'], pptx: ['PPT', '#d97c2b'],
  apk: ['APK', '#58a05c'],
  txt: ['TXT', '#8a8f98'], md: ['TXT', '#8a8f98'],
};
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','😜','🤪','😇','🙂','😉','😌','😴','🥳','😤','😭','😱','👍','👎','👏','🙏','💪','👌','✌️','❤️','💔','💯','🔥','🎉','🌹','☀️','🌙','⭐','✅','❌','🚀','🐶','🐱','🍺','☕','🎂'];

const DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';


function fileList(media) {
  const files = (media || []).filter((m) => m && m.url && m.type === 'file');
  if (!files.length) return '';
  return files
    .map((m) => {
      const name = m.name || decodeURIComponent((m.url.split('/').pop() || '附件').split('?')[0]);
      const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
      const t = FILE_TYPES[ext];
      const ico = t
        ? `<span class="file-ico" style="background:${t[1]}">${t[0]}</span>`
        : `<span class="file-ico" style="background:#576b95">${DOWNLOAD_SVG}</span>`;
      return `<a class="file-card" href="${esc(m.url)}" download>${ico}<span class="file-meta"><span class="file-name">${esc(name)}</span><span class="file-sub">点击下载</span></span></a>`;
    })
    .join('');
}

function mediaGrid(media) {
  const items = (media || []).filter((m) => m && m.url && m.type !== 'file');
  if (!items.length) return '';
  // 只有一个视频附件时用统一播放框（整列宽、按原比例完整显示），与嵌入视频同规格
  if (items.length === 1 && items[0].type === 'video') {
    return `<div class="vframe"><video src="${esc(items[0].url)}" controls preload="metadata" playsinline></video></div>`;
  }
  const cls = 'g' + Math.min(items.length, 9);
  const cells = items
    .slice(0, 9)
    .map((m) =>
      m.type === 'video'
        ? `<video src="${esc(m.url)}" controls preload="metadata" playsinline></video>`
        : `<img src="${esc(m.url)}" loading="lazy" alt="" title="点击查看原图">`
    )
    .join('');
  return `<div class="grid ${cls}">${cells}</div>`;
}

function extBlock(memo) {
  const ext = parseJsonSafe(memo.ext_data, {});
  if (!memo.ext_type) return '';
  if (memo.ext_type === 'video' && ext.embed) {
    const vertical = String(ext.embed).includes('open.douyin.com');
    if (vertical) {
      // 抖音播放器页有最小布局宽度：按 450x800 设计尺寸渲染再等比缩放进统一框宽，裁掉溢出，绝不出现滚动条
      return `<div class="ext ext-vertical"><div class="dy-scale"><iframe src="${esc(ext.embed)}" allowfullscreen loading="lazy" scrolling="no" referrerpolicy="no-referrer"></iframe></div></div>`;
    }
    return `<div class="ext"><iframe src="${esc(ext.embed)}" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe></div>`;
  }
  if (memo.ext_type === 'video' && ext.url) {
    return `<div class="vframe"><video src="${esc(ext.url)}" controls preload="metadata" playsinline></video></div>`;
  }
  if (memo.ext_type === 'music' && ext.embed) {
    return `<div class="ext" style="border:0"><iframe src="${esc(ext.embed)}" loading="lazy" style="aspect-ratio:auto;height:86px"></iframe></div>`;
  }
  if (memo.ext_type === 'music' && ext.url) {
    return `<div class="ext" style="padding:8px"><audio src="${esc(ext.url)}" controls preload="metadata"></audio></div>`;
  }
  if ((memo.ext_type === 'douban' || memo.ext_type === 'link') && ext.url) {
    const cover = ext.cover ? `<img src="${esc(ext.cover)}" alt="" loading="lazy">` : '';
    return `<a class="ext ext-card" href="${esc(ext.url)}" target="_blank" rel="noopener">${cover}<span><span class="t">${esc(ext.title || ext.url)}</span><div class="d">${esc(ext.desc || (memo.ext_type === 'douban' ? '豆瓣' : '链接'))}</div></span></a>`;
  }
  return '';
}

// 列表页默认只显示前 120 字，详情页显示全文
function contentHtml(memo, detail) {
  const plain = excerptOf(memo.content_md, 1000000);
  if (!detail && plain.length > 120) {
    return `<p>${esc(plain.slice(0, 120))}…</p><p><a href="/memo/${memo.id}">展开全文 →</a></p>`;
  }
  return renderContent(memo.content_md);
}

export function memoCard(memo, settings, { comments = [], liked = false, detail = false, isAdmin = false, user = null, userAvatars = {}, filesUnlocked = false, pwLocked = false, membersLocked = false, unlockErr = '' } = {}) {
  const media = parseJsonSafe(memo.media, []);
  const tags = String(memo.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const avatarStyle = settings.avatar_url
    ? `style="background-image:url('${esc(settings.avatar_url)}')"`
    : '';
  const avatarCls = settings.avatar_url ? 'm-avatar' : 'm-avatar m-avatar-fallback';
  const avatarInner = settings.avatar_url ? '' : esc((settings.nickname || '主').slice(0, 1));
  // 注册用户投稿：头像用作者注册时绑定的头像图（无图时回退用户名首字），昵称行显示作者名
  const isUserPost = memo.author_id > 0;
  const cardAvatarCls = isUserPost ? (memo.author_avatar ? 'm-avatar' : 'm-avatar m-avatar-fallback') : avatarCls;
  const cardAvatarStyle = isUserPost
    ? (memo.author_avatar ? `style="background-image:url('${esc(memo.author_avatar)}')"` : '')
    : avatarStyle;
  const cardAvatarInner = isUserPost ? (memo.author_avatar ? '' : esc((memo.author_name || '游').slice(0, 1))) : avatarInner;
  const cardNick = isUserPost ? esc(memo.author_name || '') : esc(settings.nickname);
  // 列表页：默认显示前 2 条评论（无框、纯文字行），超过 2 条时追加「共 XX 条评论，点击查看全部」
  // 详情页：显示全部评论（带回复层级）
  let cmtHtml = '';
  // 评论头像：站长（昵称与站长相同）用站点头像；游客用内置 micah 头像包（R2 site/avatars/micah/0-99.svg），
  // 按昵称哈希固定分配，同一昵称永远同一张。图取不到时 onerror 回落为内置剪影。
  const cmtAvatar = (c) => {
    if (settings.avatar_url && c.name === settings.nickname) {
      return `<img class="cmt-ava" src="${esc(settings.avatar_url)}" alt="">`;
    }
    // 注册用户用其注册时绑定的头像（注册后不可修改）
    if (userAvatars[c.name]) {
      return `<img class="cmt-ava" src="${esc(userAvatars[c.name])}" alt="" loading="lazy">`;
    }
    let h = 5381;
    const name = String(c.name || '');
    for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
    const n = h % 100;
    return `<img class="cmt-ava" src="/media/site/avatars/micah/${n}.svg" alt="" loading="lazy" onerror="this.outerHTML='&lt;svg class=&quot;cmt-ava&quot; viewBox=&quot;0 0 24 24&quot;&gt;&lt;circle class=&quot;fg&quot; cx=&quot;12&quot; cy=&quot;8.6&quot; r=&quot;3.8&quot;/&gt;&lt;path class=&quot;fg&quot; d=&quot;M3.8 20.2c1.5-3.9 4.6-5.7 8.2-5.7s6.7 1.8 8.2 5.7c-2.3 1.9-5.1 2.8-8.2 2.8s-5.9-.9-8.2-2.8z&quot;/&gt;&lt;/svg&gt;'">`;
  };
  const delCmtBtn = (c) => isAdmin
    ? `<form method="post" action="/admin/comments/${c.id}/delete" style="display:inline;margin:0" onsubmit="return confirm('确定删除这条留言？删除后移入垃圾桶。')"><button type="submit" class="reply-btn del" title="删除" aria-label="删除">&#x1F5D1;&#xFE0E;</button></form>`
    : '';
  if (!detail) {
    const total = memo.comment_count || comments.length;
    if (comments.length || total > 0) {
      const line = (c) =>
        c.admin_only && !isAdmin
          ? `<div class="cmt-line">${cmtAvatar(c)}<span class="n">${esc(c.name)}</span>：<span class="ao-hidden">🔒 隐藏评论</span></div>`
          : `<div class="cmt-line">${cmtAvatar(c)}<span class="n">${esc(c.name)}</span>${c.reply_to ? ` <span class="at">回复 @${esc(c.reply_to)}</span>` : ''}：${esc(c.content)}${c.admin_only && isAdmin ? '<span class="ao-tag">🔒 仅管理员可见</span>' : ''}${isAdmin
          ? `<button type="button" class="reply-btn" data-rname="${esc(c.name)}" title="回复" aria-label="回复" onclick="replyTo(this,${memo.id},${c.parent_id || c.id})"><img class="reply-ico" src="/media/site/icons/reply.png" alt="回复"></button>`
          : `<a class="reply-btn" href="/memo/${memo.id}?reply=${c.parent_id || c.id}&rname=${encodeURIComponent(c.name)}#comments" title="回复" aria-label="回复"><img class="reply-ico" src="/media/site/icons/reply.png" alt="回复"></a>`}${delCmtBtn(c)}</div>`;
      const first = comments.slice(0, 2).map(line).join('');
      const rest = comments.slice(2);
      const restHtml = rest.length
        ? `<div class="cmt-rest" id="cmt-rest-${memo.id}">${rest.map(line).join('')}</div>` +
          `<a class="cmt-more" href="javascript:void(0)" data-total="${total}" onclick="toggleAllComments(${memo.id},this)">共 ${total} 条评论，点击查看全部</a>`
        : '';
      cmtHtml = `<div class="cmt-lines">${first}${restHtml}</div>`;
    }
  } else if (comments.length) {
    const roots = comments.filter((c) => !c.parent_id);
    const byParent = new Map();
    for (const c of comments) {
      if (c.parent_id) {
        if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
        byParent.get(c.parent_id).push(c);
      }
    }
    const row = (c, rootId) =>
      c.admin_only && !isAdmin
        ? `<div class="cmt">${cmtAvatar(c)}<span class="n">${esc(c.name)}</span>：<span class="ao-hidden">🔒 隐藏评论</span><span class="when">${timeAgo(c.created_at)}</span></div>`
        : `<div class="cmt">${cmtAvatar(c)}<span class="n">${esc(c.name)}</span>${c.reply_to ? ` <span class="at">回复 @${esc(c.reply_to)}</span>` : ''}：${esc(c.content)}${c.admin_only && isAdmin ? '<span class="ao-tag">🔒 仅管理员可见</span>' : ''}<span class="when">${timeAgo(c.created_at)}</span><button type="button" class="reply-btn" data-rname="${esc(c.name)}" title="回复" aria-label="回复" onclick="replyTo(this,${memo.id},${rootId})"><img class="reply-ico" src="/media/site/icons/reply.png" alt="回复"></button>${delCmtBtn(c)}</div>`;
    cmtHtml = `<div class="cmt-box">${roots
      .map((r) => row(r, r.id) + (byParent.get(r.id) || []).map((c) => `<div class="replies">${row(c, r.id)}</div>`).join(''))
      .join('')}</div>`;
  }
  const locked = pwLocked || membersLocked;
  if (locked) cmtHtml = '';
  const membersOnly = memo.comments_members_only && !isAdmin && !user;
  const identityHtml = isAdmin
    ? ''
    : user
      ? `<div class="hint" style="margin-bottom:8px">以注册用户「${esc(user.username)}」的身份评论</div>`
      : `<div class="hint" style="margin-bottom:8px">以游客身份评论，昵称随机显示为「游客XXX」，只需填验证码 · <a href="/login">登录</a>${settings.registration_open === '1' ? ' / <a href="/register">注册</a>' : ''}</div>`;
  const capRow = isAdmin || user
    ? ''
    : `<div class="row"><img class="cap" alt="验证码" title="点图刷新" onclick="refreshCap(this)">
              <input name="captcha" maxlength="4" placeholder="验证码" required style="max-width:110px"></div>`;
  const cmtForm =
    !locked && settings.comments_enabled === '1'
      ? membersOnly
        ? `<div class="cmt-form" id="cmt-form-${memo.id}"><div class="files-gated" style="margin:4px 0">🔒 本动态仅注册用户可评论，<a href="/login?next=/memo/${memo.id}">登录</a>${settings.registration_open === '1' ? ` 或 <a href="/register?next=/memo/${memo.id}">注册</a>` : ''}后即可评论</div></div>`
        : `<div class="cmt-form" id="cmt-form-${memo.id}">
          <form method="post" action="/memo/${memo.id}/comment">
            <input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true">
            <input type="hidden" name="ft" value="${Math.floor(Date.now() / 1000)}">
            <input type="hidden" name="parent_id" value="0">
            <input type="hidden" name="reply_to" value="">
            ${identityHtml}${capRow}
            <textarea name="content" rows="3" maxlength="50" data-ph="写下你的评论（最多 50 字）${isAdmin || settings.comments_moderation === '0' ? '' : '（审核后显示）'}" placeholder="写下你的评论（最多 50 字）${isAdmin || settings.comments_moderation === '0' ? '' : '（审核后显示）'}" required></textarea>
            <div class="btn-row"><button class="btn" type="submit">发表评论</button><button class="btn ghost" type="button" id="cancel-reply-${memo.id}" style="display:none" onclick="cancelReply(${memo.id})">取消回复</button>${isAdmin ? '' : `<label class="ao-check"><input type="checkbox" name="admin_only" value="1">仅管理员可见</label>`}<button class="emoji-toggle" type="button" title="插入表情" onclick="toggleEmoji(${memo.id})">😊</button></div>
            <div class="emoji-panel" id="emoji-panel-${memo.id}">${EMOJIS.map((e) => `<button type="button" class="emo" onclick="insertEmoji(${memo.id},this)">${e}</button>`).join('')}</div>
          </form>
        </div>`
      : '';
  return `<article class="memo">
    <div class="memo-head">
      <div class="${cardAvatarCls}" ${cardAvatarStyle}>${cardAvatarInner}</div>
      <div>
        <div class="m-nick">${cardNick}${memo.pinned ? `<span class="pin">${'⭐'.repeat(memo.pinned)} 置顶</span>` : ''}${memo.hidden && isAdmin ? '<span class="pin" style="color:#999">🔒 隐藏</span>' : ''}${memo.view_password_hash && isAdmin ? '<span class="pin">🔑 密码</span>' : ''}${memo.members_only && isAdmin ? '<span class="pin">👥 仅注册用户</span>' : ''}</div>
      </div>
    </div>
    <div class="m-body">
      ${memo.title ? `<div class="m-title">${esc(memo.title)}</div>` : ''}
      ${membersLocked
        ? `<div class="files-gated">🔒 本动态仅注册用户可见，<a href="/login?next=/memo/${memo.id}">登录</a>${settings.registration_open === '1' ? ` 或 <a href="/register?next=/memo/${memo.id}">注册</a>` : ''}后即可查看</div>`
        : pwLocked
        ? `<div class="files-gated">🔒 此动态已设密码保护${detail ? '' : `，<a href="/memo/${memo.id}">输入密码查看 →</a>`}</div>${detail ? `${unlockErr ? `<div style="color:#e5484d;margin-top:8px;font-size:14px">${unlockErr}</div>` : ''}<form method="post" action="/memo/${memo.id}/unlock" style="margin-top:8px;display:flex;gap:8px"><input type="password" name="password" placeholder="输入观看密码" required style="flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)"><button class="btn" type="submit">查看</button></form>` : ''}`
        : (memo.content_gated && !filesUnlocked)
        ? `<div class="files-gated">🔒 本动态内容需回复后可见，<a href="${detail ? '#comments' : `/memo/${memo.id}#comments`}">评论后即可查看</a></div>`
        : `<div class="m-content">${contentHtml(memo, detail)}</div>
      ${mediaGrid(media)}
      ${(memo.files_gated && !filesUnlocked && media.some((mm) => mm && mm.url && mm.type === 'file'))
        ? `<div class="files-gated">🔒 附件文件需回复后可见，<a href="${detail ? '#comments' : `/memo/${memo.id}#comments`}">评论后即可查看</a></div>`
        : fileList(media)}
      ${extBlock(memo)}`}
      ${tags.length ? `<div class="tags">${tags.map((t) => `<a class="tag" href="/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
    </div>
    <div class="m-foot">
      <span class="time">${timeAgo(memo.created_at)}</span>
      ${detail ? '' : `<a href="/memo/${memo.id}" style="color:var(--sub)">详情</a>`}
      ${isAdmin ? `<a class="act" href="/admin/memos/${memo.id}/edit" style="text-decoration:none">✏️ 编辑</a>` : ''}
      ${isAdmin ? `<form method="post" action="/admin/memos/${memo.id}/delete" style="display:inline;margin:0" onsubmit="return confirm('确定删除这条动态？评论和点赞会一并移入垃圾桶。')"><button class="act" type="submit" style="color:#e5484d">&#x1F5D1;&#xFE0E; 删除</button></form>` : ''}
      ${user && settings.users_can_post === '1' && memo.author_id === user.id ? `<a class="act" href="/post/${memo.id}/edit" style="text-decoration:none">✏️ 编辑</a><form method="post" action="/post/${memo.id}/delete" style="display:inline;margin:0" onsubmit="return confirm('确定删除这条动态？评论和点赞会一并移入垃圾桶。')"><button class="act" type="submit" style="color:#e5484d">&#x1F5D1;&#xFE0E; 删除</button></form>` : ''}
      <span class="spacer"></span>
      ${locked ? '' : `<button class="act${liked ? ' liked' : ''}" onclick="likeMemo(${memo.id},this)">❤ <span class="lc">${memo.like_count || 0}</span></button>
      ${(detail || isAdmin)
        ? `<button class="act" type="button" title="评论" onclick="toggleCmt(${memo.id})">💬 ${memo.comment_count || 0}</button>`
        : `<button class="act" type="button" title="评论" onclick="toggleCmt(${memo.id})">💬 ${memo.comment_count || 0}</button>`}`}
    </div>
    <div id="comments">${cmtHtml}${cmtForm}</div>
  </article>`;
}

export function layout(settings, { title, body, activeTag = '', adminView = false, user = null }) {
  const coverStyle = settings.cover_url
    ? `style="background-image:url('${esc(settings.cover_url)}')"`
    : '';
  const avatarStyle = settings.avatar_url
    ? `style="background-image:url('${esc(settings.avatar_url)}')"`
    : '';
  const avatarCls = settings.avatar_url ? 'avatar' : 'avatar avatar-fallback';
  const avatarInner = settings.avatar_url ? '' : esc((settings.nickname || '主').slice(0, 1));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || settings.site_name)}</title>
<meta name="description" content="${esc(settings.signature || '')}">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(settings.site_name)}" href="/feed.xml">
<style>${CSS}</style>
<script>try{var t=localStorage.getItem('mm_theme');if(t)document.documentElement.setAttribute('data-theme',t);else if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.setAttribute('data-theme','dark')}catch(e){}</script>
</head>
<body>
<div class="wrap">
 <div class="head-box">
  <button class="theme-btn" onclick="toggleTheme()" title="切换白天 / 黑夜" aria-label="切换白天 / 黑夜"><svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></button>
  <div class="cover" ${coverStyle}></div>
  <div class="head-inner">
   <div class="hero">
    <div class="site-name">${esc(settings.nickname)}</div>
    <div class="${avatarCls}" ${avatarStyle}>${avatarInner}</div>
   </div>
  <div class="head-meta">${esc(settings.signature || '')}</div>
  <div class="toolbar">
    <a class="tb-btn${!activeTag ? ' on' : ''}" href="/" title="首页" aria-label="首页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg></a>
    <span id="tag-chips"></span>
    <span class="spacer"></span>
    ${!adminView ? (user
      ? `${settings.users_can_post === '1' ? '<a class="tb-btn" href="/post/new" title="发布动态" aria-label="发布动态"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></a>' : ''}<span class="tb-user">${user.avatar ? `<img src="${esc(user.avatar)}" alt="" style="width:20px;height:20px;border-radius:50%;vertical-align:-5px;margin-right:4px">` : '👤 '}${esc(user.username)}</span><a class="tb-link" href="/logout">退出</a>`
      : `<a class="tb-link" href="/login">登录</a>${settings.registration_open === '1' ? '<a class="tb-link" href="/register">注册</a>' : ''}`) : ''}
    ${adminView ? '<a class="tb-btn" href="/admin/memos/new" title="发布" aria-label="发布"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></a><a class="tb-btn" href="/admin/logout" title="退出" aria-label="退出"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.6v15.6a1 1 0 0 1-1.2 1L5 20V5.6a2 2 0 0 1 1.5-1.9l4-1A2 2 0 0 1 13 4.6Z"/></svg></a>' : ''}
  </div>
  </div>
 </div>
  ${body}
  <div class="foot-note"><a class="admin-link" href="/admin" title="进入后台">${esc(settings.site_name)}</a> · 记录生活，留住瞬间<br>Powered by v${VERSION} @TaoGe&nbsp;&nbsp;<a class="foot-gh" href="https://github.com/sandeli/cf-d1-moments" target="_blank" rel="noopener"><img class="gh-ico" src="/media/site/gh.png" alt="GitHub">cf-d1-moments</a>${(settings.site_days_text || settings.visitor_text) ? `<br>${[settings.site_days_text, settings.visitor_text].filter(Boolean).join(' · ')}` : ''}${settings.r2_usage_text ? `<br>${esc(settings.r2_usage_text)}` : ''}${settings.acct_usage_text ? `<br>${esc(settings.acct_usage_text)}` : ''}</div>
</div>
<div class="lightbox" id="lightbox" onclick="closeLightbox()"><img id="lightbox-img" alt=""></div>
<script>${JS}</script>
</body>
</html>`;
}

export function tagChipsScript(tags, activeTag) {
  const chips = tags
    .map(
      (t) =>
        `<a class="chip${t.tag === activeTag ? ' on' : ''}" href="/tag/${encodeURIComponent(t.tag)}">#${esc(t.tag)}（${t.c}）</a>`
    )
    .join(' ');
  return `<script>document.getElementById('tag-chips').innerHTML=${JSON.stringify(chips)}</script>`;
}

export function linksBlock(settings) {
  const links = parseJsonSafe(settings.links, []);
  if (!links.length) return '';
  return `<div class="links-box"><h3>友情链接</h3>${links
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`)
    .join('')}</div>`;
}

export function pagerHtml(page, hasMore, base) {
  const prev = page > 1 ? `<a href="${base}${base.includes('?') ? '&' : '?'}page=${page - 1}">← 上一页</a>` : '';
  const next = hasMore ? `<a href="${base}${base.includes('?') ? '&' : '?'}page=${page + 1}">下一页 →</a>` : '';
  if (!prev && !next) return '';
  return `<div class="pager">${prev}<span>第 ${page} 页</span>${next}</div>`;
}

export function noticeHtml(code) {
  const map = {
    commented: '评论已发表，谢谢！',
    commented_mod: '评论已提交，审核通过后就会显示，谢谢！',
    captcha: '验证码不对，请重新填写。',
    closed: '评论功能已关闭。',
    empty: '内容不能为空。',
    members: '本动态仅注册用户可评论，请先登录或注册。',
    membersview: '本动态仅注册用户可见，请先登录或注册。',
  };
  return code && map[code] ? `<div class="notice">${map[code]}</div>` : '';
}
