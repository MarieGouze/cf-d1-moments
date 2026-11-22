// 前台渲染：仿 kingwrcy/moments 的朋友圈版面（封面头图 + 头像 + 单栏时间线），样式为自研实现。
import { escapeHtml as esc } from './markdown.js';
import { renderContent, excerptOf } from './richtext.js';
import { parseJsonSafe, VERSION } from './db.js';

export const CSS = `
:root{
  --bg:#f4f4f6; --card:#ffffff; --text:#1f2329; --sub:#8a8f98; --line:#e7e7ea; --line-strong:#c9ccd4;
  --accent:#576b95; --link:#1e6fd9; --chip:#eef0f4; --shadow:0 1px 3px rgba(0,0,0,.05);
  --pat:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='236' height='236' viewBox='0 0 236 236'%3E%3Cg fill='none' stroke='%237d9dbd' stroke-opacity='.06' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cg transform='translate(22 18) rotate(-10 12 12) scale(.95)'%3E%3Cpath d='M12 2.5l2.4 6.1 6.6.5-5 4.1 1.6 6.4L12 15.9 6.4 19.6l1.6-6.4-5-4.1 6.6-.5z'/%3E%3C/g%3E%3Cg transform='translate(112 12) rotate(8 12 12) scale(.85)'%3E%3Cpath d='M12 19.2C6.9 15.6 4 12.7 4 9.4 4 7 5.8 5.1 8.1 5.1c1.6 0 3 .9 3.9 2.2.9-1.3 2.3-2.2 3.9-2.2 2.3 0 4.1 1.9 4.1 4.3 0 3.3-2.9 6.2-8 9.8z'/%3E%3C/g%3E%3Cg transform='translate(186 26) rotate(10 12 12) scale(.9)'%3E%3Cpath d='M9.5 18.8V6.2L19.5 4v11.3'/%3E%3Cellipse cx='7.3' cy='18.8' rx='2.6' ry='2'/%3E%3Cellipse cx='17.3' cy='15.3' rx='2.6' ry='2'/%3E%3C/g%3E%3Cg transform='translate(52 74) scale(1)'%3E%3Cpath d='M7 18.2h9.7a4.1 4.1 0 0 0 .9-8.1A5.6 5.6 0 0 0 6.5 8.6a4.6 4.6 0 0 0 .5 9.6z'/%3E%3C/g%3E%3Cg transform='translate(150 80) rotate(-12 12 12) scale(.9)'%3E%3Cpath d='M3.5 11.2L20.5 4 13.8 20.5l-2.4-6.9-7.9-2.4z'/%3E%3Cpath d='M11.4 13.6L20.5 4'/%3E%3C/g%3E%3Cg transform='translate(92 48) rotate(24 12 12) scale(.8)'%3E%3Crect x='6.8' y='10.7' width='10.4' height='2.6' rx='1.3'/%3E%3Ccircle cx='6.8' cy='9.6' r='2.3'/%3E%3Ccircle cx='6.8' cy='14.4' r='2.3'/%3E%3Ccircle cx='17.2' cy='9.6' r='2.3'/%3E%3Ccircle cx='17.2' cy='14.4' r='2.3'/%3E%3C/g%3E%3Cg transform='translate(204 70) scale(.8)'%3E%3Cpath d='M3 12c3.2-4.2 6.8-6 10.2-6 3.4 0 6.2 2 7.8 6-1.6 4-4.4 6-7.8 6C9.8 18 6.2 16.2 3 12z'/%3E%3C/g%3E%3Cg transform='translate(28 138) rotate(8 12 12) scale(.9)'%3E%3Ccircle cx='12' cy='12' r='2'/%3E%3Ccircle cx='12' cy='6.8' r='2.9'/%3E%3Ccircle cx='16.8' cy='10.2' r='2.9'/%3E%3Ccircle cx='14.9' cy='16' r='2.9'/%3E%3Ccircle cx='9.1' cy='16' r='2.9'/%3E%3Ccircle cx='7.2' cy='10.2' r='2.9'/%3E%3C/g%3E%3Cg transform='translate(96 118) rotate(-12 12 12) scale(.85)'%3E%3Cellipse cx='12' cy='15' rx='4.6' ry='3.8'/%3E%3Ccircle cx='5.6' cy='9.4' r='1.7'/%3E%3Ccircle cx='9.8' cy='7.2' r='1.7'/%3E%3Ccircle cx='14.2' cy='7.2' r='1.7'/%3E%3Ccircle cx='18.4' cy='9.4' r='1.7'/%3E%3C/g%3E%3Cg transform='translate(204 138) scale(.95)'%3E%3Ccircle cx='12' cy='12' r='8.2'/%3E%3Cpath d='M8.3 14.8a4.8 4.8 0 0 0 7.4 0'/%3E%3C/g%3E%3Cg transform='translate(118 156) scale(.85)'%3E%3Cpath d='M8.2 11.2L12 20.5l3.8-9.3'/%3E%3Cpath d='M7.4 11.2a4.6 4.6 0 0 1 9.2 0'/%3E%3C/g%3E%3Cg transform='translate(142 186) scale(.9)'%3E%3Cpath d='M19.2 14.6A8.2 8.2 0 1 1 9.4 4.8a6.6 6.6 0 0 0 9.8 9.8z'/%3E%3C/g%3E%3Cg transform='translate(40 202) rotate(18 12 12) scale(.85)'%3E%3Cpath d='M5.5 18.5C5.5 10.5 12 5 19.5 5c0 7.7-4.3 13.5-14 13.5z'/%3E%3Cpath d='M5.5 18.5C8 13.8 11.8 9.6 16.5 6.8'/%3E%3C/g%3E%3Cg transform='translate(188 206) rotate(5 12 12) scale(.82)'%3E%3Crect x='3.6' y='6.2' width='16.8' height='11.6' rx='2'/%3E%3Cpath d='M4.2 7.4l7.8 5.8 7.8-5.8'/%3E%3C/g%3E%3Cg transform='translate(80 168)'%3E%3Cpath d='M0-3v6M-3 0h6'/%3E%3C/g%3E%3Cg transform='translate(168 118) scale(.5)'%3E%3Cpath d='M12 2.5l2.4 6.1 6.6.5-5 4.1 1.6 6.4L12 15.9 6.4 19.6l1.6-6.4-5-4.1 6.6-.5z'/%3E%3C/g%3E%3C/g%3E%3Cg fill='%237d9dbd' fill-opacity='.06'%3E%3Ccircle cx='82' cy='24' r='1.4'/%3E%3Ccircle cx='172' cy='140' r='1.4'/%3E%3Ccircle cx='16' cy='104' r='1.4'/%3E%3Ccircle cx='132' cy='228' r='1.4'/%3E%3Ccircle cx='222' cy='30' r='1.4'/%3E%3Ccircle cx='213.2' cy='148.4' r='1.15'/%3E%3Ccircle cx='220.6' cy='148.4' r='1.15'/%3E%3Ccircle cx='220.8' cy='82.6' r='1'/%3E%3C/g%3E%3C/svg%3E");
}
[data-theme="dark"]{
  --bg:#0c1425; --card:#16213a; --text:#e6ebf5; --sub:#93a3c0; --line:#263453; --line-strong:#3d4f78;
  --accent:#93b0e8; --link:#6ab0ff; --chip:#1d2b47; --shadow:0 1px 3px rgba(2,6,18,.5);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:720px;margin:0 auto;padding:0 12px 40px}
.head-box{position:relative;background:var(--card);border-radius:16px 16px 0 0;box-shadow:var(--shadow);padding:0;margin-top:12px}
.cover{position:absolute;inset:0;background:#3a3f4a center/cover no-repeat;background-size:cover;border-radius:16px 16px 0 0;z-index:0}
.cover::after{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(to bottom, rgba(10,12,20,0) 50%, rgba(10,12,20,.45) 100%)}
.head-inner{position:relative;z-index:1;padding:0 16px 20px}
.hero{position:relative;height:238px}
.hero .site-name{position:absolute;right:96px;bottom:-21px;color:#fff;font-size:19px;font-weight:600;line-height:1.25;
  text-shadow:0 1px 4px rgba(0,0,0,.55)}
.hero .avatar{position:absolute;right:16px;bottom:-22px;width:68px;height:68px;border-radius:10px;
  border:3px solid #fff;background:#cfd4dd center/cover no-repeat;box-shadow:var(--shadow)}
.hero .avatar-fallback{display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;background:#7a8494}
@media (max-width:640px){.hero .avatar{width:52px;height:52px;bottom:-18px;border-radius:9px}.hero .avatar-fallback{font-size:22px}.hero .site-name{right:80px;bottom:-17px;font-size:18px}.head-meta{margin-top:24px}}
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
.head-box,.feed-box{background-image:var(--pat);background-size:340px 340px}
.memo{background:transparent;border-radius:0;box-shadow:none;padding:12px 0 8px;margin:0}
.memo-head{display:flex;gap:10px;align-items:center}
.memo-head .m-avatar{flex:0 0 42px;width:42px;height:42px;border-radius:8px;background:#cfd4dd center/cover no-repeat}
.memo-head .m-avatar-fallback{display:flex;align-items:center;justify-content:center;color:#fff;background:#7a8494;font-size:18px}
.m-nick{color:var(--accent);font-weight:600;font-size:15px}
.m-body{margin-left:52px}
.m-title{font-size:17px;font-weight:700;line-height:1.4;margin:0 0 6px;color:var(--text)}
.m-title-link{display:block;text-decoration:none;color:inherit}
.m-content{font-size:15px;line-height:1.65;word-break:break-word}
.m-content p{margin:6px 0}
.m-content img{max-width:100%;border-radius:8px}
.m-content pre{background:var(--chip);padding:10px;border-radius:8px;overflow:auto;font-size:13px}
.m-content code{background:var(--chip);padding:1px 5px;border-radius:4px;font-size:13px}
.m-content pre code{background:none;padding:0}
.m-content blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid var(--line);color:var(--sub)}
.m-content a{text-decoration:underline}
.m-content a.more-link{color:var(--link);font-weight:600;text-decoration:none;white-space:nowrap;margin-left:12px}
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
@media (max-width:640px){.grid{max-width:300px}.grid.g1{max-width:270px}.grid.g2,.grid.g4{max-width:250px}}
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
.cmt-ico-shake{display:inline-block;transform-origin:50% 90%;animation:cmtShake 3s ease-in-out infinite}
@keyframes cmtShake{0%,52%,100%{transform:none}58%{transform:translateX(-2.5px) rotate(-20deg) scale(1.1)}65%{transform:translateX(2.5px) rotate(16deg) scale(1.13)}72%{transform:translateX(-2px) rotate(-11deg) scale(1.08)}79%{transform:translateX(1.5px) rotate(7deg)}86%{transform:translateX(-0.5px) rotate(-3deg)}93%{transform:none}}
@media (prefers-reduced-motion:reduce){.cmt-ico-shake{animation:none}}
[data-theme="dark"] .reply-ico{filter:invert(1)}
.cmt .at{color:var(--accent)}
.replies{margin:2px 0 4px 14px;padding-left:10px;border-left:2px solid var(--line)}
.cmt-lines{margin:6px 0 2px 52px;font-size:14px}
.cmt-rest{display:none}
.cmt-rest.open{display:block}
.cmt-line{padding:1px 0;word-break:break-word}
.cmt-line.sub{margin-left:14px;padding-left:10px;border-left:2px solid var(--line)}
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
.cmt-badge{display:inline-block;font-size:10px;line-height:1.5;padding:0 5px;border-radius:6px;margin-left:4px;vertical-align:1px;font-weight:600;color:#fff;white-space:nowrap}
.cmt-badge.boss{background:#f0a500}
.cmt-badge.author{background:#576b95}
.at-boss{color:#d98e00;font-weight:700}
.at-author{color:var(--accent);font-weight:700}
.invalid-cmt{color:var(--sub);font-style:italic}
.ao-hidden{color:#d97706;font-weight:600}
.bell{position:relative;font-size:15px}
.nbadge{position:absolute;top:-2px;right:-6px;background:#e5484d;color:#fff;font-size:10px;font-weight:700;line-height:1;padding:2px 5px;border-radius:999px;min-width:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.dm-link{text-decoration:none;cursor:pointer}
.cmt .dm-link,.cmt-line .dm-link{color:var(--accent);font-weight:600}
.dm-mask{position:fixed;inset:0;background:rgba(10,14,24,.55);display:none;align-items:center;justify-content:center;z-index:120;padding:16px}
.dm-mask.open{display:flex}
.dm-box{background:var(--card);color:var(--text);border-radius:14px;max-width:420px;width:100%;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.3)}
.dm-box h3{margin:0 0 10px;font-size:16px}
.dm-box textarea,.th-form textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);font-size:14px;font-family:inherit;min-height:84px}
.dm-box .row,.th-form .row{display:flex;gap:8px;align-items:flex-start;margin-top:8px}
.dm-box .row input,.th-form .row input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);font-size:14px}
.dm-box img.cap,.th-form img.cap{height:40px;border-radius:6px;cursor:pointer;border:1px solid var(--line)}
.dm-err{color:#e5484d;font-size:13px;min-height:18px;margin-top:6px}
.msg-row{display:flex;margin:8px 0}
.msg-row.me{justify-content:flex-end}
.msg-row>div{max-width:78%}
.msg-bub{padding:8px 12px;border-radius:12px;background:var(--chip);font-size:14px;line-height:1.55;word-break:break-word}
.msg-row.me .msg-bub{background:var(--accent);color:#fff}
.m-inline{margin:10px 0}
.m-inline img{width:100%;border-radius:10px;display:block}
.fr-item{border-bottom:1px dashed var(--line)}
.fr-item:last-child{border-bottom:none}
.fr-bar{display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;padding:14px 6px;cursor:pointer;color:var(--text);font-size:15px;text-align:left;font-family:inherit;border-radius:8px;transition:background .15s}
.fr-bar:hover{background:var(--chip)}
.fr-bar.open{background:var(--chip)}
.fr-bar .fr-t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:.2px}
.fr-bar .fr-pin{margin-right:5px;font-size:12px}
.fr-bar .fr-meta{font-size:12px;color:var(--sub);white-space:nowrap;font-weight:400}
.fr-bar .fr-arrow{color:var(--sub);font-size:13px;transition:transform .18s;flex:none}
.fr-bar.open .fr-arrow{transform:rotate(180deg)}
.fr-body{padding:4px 0 10px}
.fr-body .memo{border-bottom:none;padding-bottom:2px}
.msg-when{font-size:11px;color:var(--sub);margin:2px 2px 0}
.msg-row.me .msg-when{text-align:right}
.ntf-head{font-size:16px;font-weight:700;padding:10px 0 6px;display:flex;align-items:center}
.ntf-link{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0;color:inherit;text-decoration:none}
.ntf form{margin:0;flex:none}
.ntf-del{background:none;border:none;color:var(--sub);font-size:13px;cursor:pointer;padding:2px 6px;line-height:1.4}
.ntf-del:hover{color:#e5484d}
.ntf-clear{margin-left:auto}
.ntf-clear button{background:none;border:1px solid var(--line);color:var(--sub);font-size:12px;font-weight:400;border-radius:999px;padding:3px 12px;cursor:pointer}
.ntf-clear button:hover{color:#e5484d;border-color:#e5484d}
.ntf{display:flex;align-items:baseline;gap:8px;padding:10px 2px;border-bottom:1px dashed var(--line);color:var(--text);font-size:14px;text-decoration:none}
.ntf:last-child{border-bottom:0}
.ntf-dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:transparent;position:relative;top:-1px}
.ntf.unread .ntf-dot{background:#e5484d}
.ntf-main{flex:1;word-break:break-word}
.ntf-when{flex:none;color:var(--sub);font-size:12px;white-space:nowrap}
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
.foot-note{text-align:center;color:var(--sub);
