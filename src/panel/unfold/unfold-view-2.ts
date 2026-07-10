/* =====================================================================
   unfold-view-2.ts — the primary surface's injected CSS (split out of
   unfold.ts verbatim; a pure string constant, no behaviour).
   ===================================================================== */

export const UNFOLD_CSS = `
.uf-overlay{position:fixed;inset:0;z-index:70;display:none;
  --uf-bg:#f3f1ec;--uf-stage:#f6f4ef;--uf-surface:#ffffff;--uf-surface2:#faf8f3;
  --uf-line:#e6e2d9;--uf-line-soft:#efece4;--uf-hair:#f1eee7;
  --uf-ink:#33322e;--uf-ink2:#605c54;--uf-dim:#948f84;--uf-faint:#bbb4a7;
  --uf-accent:#4a6b8a;--uf-accent-soft:rgba(74,107,138,.10);--uf-accent-line:rgba(74,107,138,.32);
  --uf-k-type:#7c6aa8;--uf-k-function:#4a6b8a;--uf-k-module:#4a8a72;--uf-k-store:#a8824a;--uf-k-class:#a85a6a;
  --uf-shadow:0 1px 2px rgba(40,36,30,.04),0 6px 20px rgba(40,36,30,.05);
  --uf-shadow-lift:0 2px 6px rgba(40,36,30,.07),0 14px 40px rgba(40,36,30,.09);
  --uf-ease:cubic-bezier(.22,.61,.36,1);
  background:var(--uf-bg);color:var(--uf-ink);
  font:14px/1.55 var(--uf-font, Inter,-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui);
  -webkit-font-smoothing:antialiased}
.uf-overlay.dark{
  --uf-bg:#131315;--uf-stage:#161618;--uf-surface:#1c1c1f;--uf-surface2:#212125;
  --uf-line:#2b2b30;--uf-line-soft:#242428;--uf-hair:#202024;
  --uf-ink:#e7e4dd;--uf-ink2:#b4afa5;--uf-dim:#8b867c;--uf-faint:#5c584f;
  --uf-accent:#82a8cc;--uf-accent-soft:rgba(130,168,204,.12);--uf-accent-line:rgba(130,168,204,.34);
  --uf-k-type:#b09bd8;--uf-k-function:#82a8cc;--uf-k-module:#77c2a2;--uf-k-store:#d0a862;--uf-k-class:#d68a9a;
  --uf-shadow:0 1px 2px rgba(0,0,0,.30),0 8px 26px rgba(0,0,0,.34);
  --uf-shadow-lift:0 2px 8px rgba(0,0,0,.40),0 18px 48px rgba(0,0,0,.46)}
.uf-overlay.show{display:flex}
.uf-overlay *{box-sizing:border-box}
.uf-overlay button{font:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0}
.uf-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

.uf-stage{position:relative;flex:1;overflow:hidden;cursor:grab;background:var(--uf-stage);
  user-select:none;-webkit-user-select:none}
.uf-stage.grab{cursor:grabbing}
.uf-world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.uf-world.anim{transition:transform .7s cubic-bezier(.16,1,.3,1)}
/* wires paint ABOVE the containers: an edge between cards inside unfolded groups must stay
   visible crossing the group surfaces, or the wires layer lies by omission */
.uf-wires{position:absolute;top:0;left:0;overflow:visible;pointer-events:none;z-index:2}
.uf-content{position:relative}
.uf-dock{position:absolute;left:14px;bottom:14px;display:flex;gap:6px;z-index:20}
.uf-dock button{width:34px;height:34px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--uf-line);border-radius:8px;background:var(--uf-surface);color:var(--uf-ink2);
  box-shadow:var(--uf-shadow);transition:color .15s,border-color .15s}
.uf-dock button:hover{color:var(--uf-ink);border-color:var(--uf-faint)}
.uf-dock svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;
  stroke-linejoin:round}
.uf-dock .uf-gap{width:8px}
.uf-dock .uf-legacy{width:auto;padding:0 10px;font-size:11px;letter-spacing:.4px;color:var(--uf-faint)}
.uf-hint{position:absolute;left:0;right:0;bottom:16px;text-align:center;z-index:15;pointer-events:none;
  color:var(--uf-faint);font-size:12px}
.uf-hint b{color:var(--uf-dim);font-weight:500}

.uf-grp{border:1px solid var(--uf-line);border-radius:12px;background:var(--uf-surface2);padding:13px;flex:none}
.uf-grp>.uf-ghead{display:flex;align-items:center;gap:9px;padding:2px 4px 11px;cursor:pointer;user-select:none}
.uf-grp>.uf-ghead .uf-tw{width:15px;height:15px;flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);transition:transform .2s var(--uf-ease)}
.uf-grp>.uf-ghead .uf-tw svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;
  stroke-linejoin:round}
.uf-grp.open>.uf-ghead .uf-tw{transform:rotate(90deg)}
.uf-grp>.uf-ghead .uf-tw:hover{color:var(--uf-ink)}
.uf-grp.sel{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent)}
.uf-grp.sel>.uf-ghead .uf-gname{color:var(--uf-accent)}
.uf-grp>.uf-ghead .uf-gname{font-weight:500;font-size:12px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--uf-ink2)}
.uf-grp>.uf-ghead .uf-gcount{color:var(--uf-faint);font-size:11px;margin-left:auto;
  font-family:ui-monospace,Menlo,monospace}
.uf-gbody{display:flex;gap:14px;align-items:flex-start}
.uf-grp.col>.uf-gbody{flex-direction:column}
.uf-grp.row>.uf-gbody,.uf-grp.leaf>.uf-gbody{flex-direction:row;flex-wrap:wrap;gap:11px}

.uf-card{position:relative;border:1px solid var(--uf-line);border-radius:10px;background:var(--uf-surface);
  padding:11px 13px;cursor:pointer;min-width:140px;max-width:230px;flex:none;box-shadow:var(--uf-shadow);
  transition:border-color .16s,box-shadow .16s,transform .16s,opacity .18s}
.uf-card:hover{border-color:var(--uf-faint);box-shadow:var(--uf-shadow-lift);transform:translateY(-1px)}
.uf-card .uf-crow{display:flex;align-items:center;gap:8px}
.uf-card .uf-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--uf-faint)}
.uf-overlay.color .uf-card .uf-dot{background:var(--uf-kc,var(--uf-faint))}
.uf-card .uf-cname{font-weight:500;font-size:13px;color:var(--uf-ink);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.uf-card.sym .uf-cname{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.uf-card .uf-cmeta{color:var(--uf-faint);font-size:10.5px;font-family:ui-monospace,Menlo,monospace;margin-top:4px}
.uf-card .uf-cdesc{color:var(--uf-ink2);font-size:11.5px;line-height:1.5;margin-top:6px;
  display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uf-card .uf-open{position:absolute;top:0;right:0;width:25px;height:100%;display:flex;align-items:center;
  justify-content:center;color:var(--uf-faint);opacity:0;transition:opacity .15s}
.uf-card:hover .uf-open{opacity:1}
.uf-card .uf-open:hover{color:var(--uf-accent)}
.uf-card .uf-open svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;
  stroke-linejoin:round}
.uf-card.can-open{padding-right:25px}
.uf-card.sel{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent),var(--uf-shadow-lift)}
.uf-card.nbr{border-color:var(--uf-accent-line)}
.uf-card.dim{opacity:.32}
.uf-card.sel2{border-color:var(--uf-accent-line)}
.uf-card .uf-cstage{display:none;position:absolute;top:-9px;right:12px;font-family:ui-monospace,Menlo,monospace;
  font-size:10px;
  color:var(--uf-accent);background:var(--uf-surface);border:1px solid var(--uf-accent-line);border-radius:6px;
  padding:1px 8px;line-height:15px}
.uf-card.sel .uf-cstage{display:block}
.uf-card .uf-cstage:hover{background:var(--uf-accent-soft);color:var(--uf-accent)}
.uf-card.bh1{border-color:color-mix(in srgb,var(--uf-accent) 62%,var(--uf-line));
  box-shadow:0 0 0 1px var(--uf-accent-line),var(--uf-shadow-lift)}
.uf-card.bh2{border-color:color-mix(in srgb,var(--uf-accent) 36%,var(--uf-line))}
.uf-card.bh3{border-color:color-mix(in srgb,var(--uf-accent) 18%,var(--uf-line))}
.uf-card .uf-bhop{position:absolute;top:-7px;left:10px;font-family:ui-monospace,Menlo,monospace;font-size:9px;
  color:var(--uf-accent);background:var(--uf-surface);border:1px solid var(--uf-accent-line);border-radius:5px;
  padding:0 4px;line-height:12px}
.uf-overlay:not(.metrics) .uf-card .uf-cmeta{display:none}
.uf-overlay:not(.desc) .uf-card .uf-cdesc{display:none}
.uf-iface{margin-top:8px;border-top:1px solid var(--uf-hair);padding-top:7px}
.uf-iface .uf-ilab{color:var(--uf-faint);font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  font-family:ui-monospace,Menlo,monospace}
.uf-iface .uf-irow{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--uf-ink2);margin:3px 0 0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px}
.uf-iface .uf-vn{color:var(--uf-dim)}
.uf-overlay:not(.iface) .uf-card .uf-iface{display:none}
.uf-overlay.iface .uf-card.sym{min-width:220px;max-width:280px}

.uf-panel{position:relative;width:330px;flex:none;border-left:1px solid var(--uf-line);background:var(--uf-bg);
  display:flex;flex-direction:column;z-index:30}
.uf-panel[hidden],.uf-rail[hidden],.uf-pbody[hidden]{display:none}
.uf-pbody{flex:1;overflow-y:auto;overflow-x:hidden}
.uf-rsz{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:40}
.uf-rsz:hover,.uf-rsz.on{background:linear-gradient(90deg,transparent 2px,
  var(--uf-accent-line) 2px,var(--uf-accent-line) 4px,transparent 4px)}
.uf-tabs{display:flex;align-items:flex-start;gap:2px;padding:10px 10px 9px;border-bottom:1px solid var(--uf-line);
  flex:none}
.uf-tabrows{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;background:var(--uf-surface2);
  border:1px solid var(--uf-line);border-radius:9px;padding:3px}
.uf-tabrow{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.uf-tab{padding:5px 9px;border-radius:6px;color:var(--uf-dim);font-size:10.5px;font-weight:700;letter-spacing:.08em;
  transition:color .15s,background .15s,box-shadow .15s}
.uf-tab:hover{color:var(--uf-ink)}
.uf-tab.on{color:var(--uf-ink);background:var(--uf-surface);box-shadow:var(--uf-shadow)}
.uf-pcol{margin-left:auto;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);border-radius:6px;margin-top:2px}
.uf-pcol:hover{color:var(--uf-ink);background:var(--uf-surface2)}
.uf-pcol svg,.uf-rail svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;
  stroke-linejoin:round}
.uf-rail{width:30px;flex:none;border-left:1px solid var(--uf-line);background:var(--uf-bg);display:flex;
  flex-direction:column;align-items:center;padding-top:10px;z-index:30}
.uf-rail button{width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--uf-faint);
  border-radius:6px}
.uf-rail button:hover{color:var(--uf-ink);background:var(--uf-surface2)}
.uf-iobtn{display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border:1px solid var(--uf-line);
  border-radius:8px;background:var(--uf-surface);color:var(--uf-ink2);font-size:12.5px;
  transition:border-color .15s,color .15s}
.uf-iobtn:hover{border-color:var(--uf-faint);color:var(--uf-ink)}
.uf-iobtn .uf-ld{display:block;color:var(--uf-faint);font-size:10.5px;margin-top:2px}
.uf-ioinfo{color:var(--uf-faint);font-size:11px;padding:2px 2px 0}
.uf-mmdtext{width:100%;height:46vh;resize:vertical;padding:9px 10px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);color:var(--uf-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:1.5;white-space:pre;margin:2px 0 8px}
.uf-iorow{display:flex;gap:8px}
.uf-iorow .uf-iobtn{margin:0;text-align:center}
.uf-sec{border-bottom:1px solid var(--uf-line)}
.uf-sech{display:flex;align-items:center;gap:8px;padding:13px 16px 5px;color:var(--uf-dim);font-size:10px;
  font-weight:600;letter-spacing:.12em}
.uf-sech::after{content:'';flex:1;min-width:10px;height:1px;background:var(--uf-line);order:1}
.uf-sech .uf-n{margin-left:auto;color:var(--uf-faint);font-family:ui-monospace,Menlo,monospace;font-weight:400;order:2}
.uf-secb{padding:4px 10px 14px}
.uf-layer{display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:8px;cursor:pointer}
.uf-layer:hover{background:var(--uf-surface2)}
.uf-layer .uf-sw{width:30px;height:18px;border-radius:10px;background:var(--uf-line);position:relative;flex:none;
  transition:background .18s}
.uf-layer .uf-sw::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:var(--uf-surface);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .2s var(--uf-ease)}
.uf-layer.on .uf-sw{background:var(--uf-accent)}
.uf-layer.on .uf-sw::after{transform:translateX(12px)}
.uf-layer .uf-lt{font-size:12.5px;color:var(--uf-ink)}
.uf-layer .uf-ld{font-size:10.5px;color:var(--uf-faint);margin-top:1px}
.uf-search{width:100%;height:32px;padding:0 11px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);
  color:var(--uf-ink);font-size:12.5px;margin:2px 0 7px}
.uf-search::placeholder{color:var(--uf-faint)}
.uf-trow{display:flex;align-items:center;gap:6px;min-height:26px;border-radius:7px;padding:0 6px;cursor:pointer}
.uf-trow:hover{background:var(--uf-surface2)}
.uf-trow .uf-ttw{width:14px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--uf-faint)}
.uf-trow .uf-ttw svg{width:8px;height:8px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;
  stroke-linejoin:round;transition:transform .18s}
.uf-trow.open>.uf-ttw svg{transform:rotate(90deg)}
.uf-trow .uf-tlabel{font-size:12px;color:var(--uf-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  flex:1}
.uf-trow.on .uf-tlabel{color:var(--uf-ink)}
.uf-trow.leaf .uf-tlabel{font-family:ui-monospace,Menlo,monospace;font-size:11px}
.uf-trow.sel{background:var(--uf-accent-soft)}
.uf-trow.sel2 .uf-tlabel{color:var(--uf-accent);text-decoration:underline;text-decoration-color:var(--uf-accent-line);
  text-underline-offset:2px}
.uf-trow .uf-tgo{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);
  opacity:0;border-radius:5px;transition:opacity .15s,color .15s}
.uf-trow:hover .uf-tgo{opacity:1}
.uf-trow .uf-tgo:hover{color:var(--uf-accent);background:var(--uf-surface2)}
.uf-trow .uf-tgo svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;
  stroke-linejoin:round}
.uf-trow .uf-tchk{width:14px;height:14px;flex:none;border:1.4px solid var(--uf-line);border-radius:4px;
  position:relative}
.uf-trow.on .uf-tchk{background:var(--uf-accent);border-color:var(--uf-accent)}
.uf-trow.on .uf-tchk::after{content:'';position:absolute;left:4px;top:1px;width:4px;height:8px;
  border:solid var(--uf-surface);border-width:0 2px 2px 0;transform:rotate(45deg)}
.uf-tkids{display:none;margin-left:13px;border-left:1px solid var(--uf-line-soft);padding-left:2px}
.uf-tkids.open{display:flex;flex-direction:column}
.uf-insp .uf-ihead{padding:14px 16px 11px}
.uf-insp .uf-ikind{display:inline-block;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  font-family:ui-monospace,Menlo,monospace;color:var(--uf-dim);border:1px solid var(--uf-line);border-radius:5px;
  padding:2px 7px;margin-bottom:8px}
.uf-insp .uf-iname{font-size:17px;font-weight:600;line-height:1.25;word-break:break-word}
.uf-insp .uf-iname.uf-mono{font-size:14px}
.uf-insp .uf-ipath{color:var(--uf-faint);font-size:11px;font-family:ui-monospace,Menlo,monospace;margin-top:5px;
  word-break:break-word}
.uf-insp .uf-idesc{color:var(--uf-ink2);font-size:12.5px;line-height:1.6;margin-top:10px}
.uf-insp .uf-iact{display:flex;gap:8px;margin-top:12px}
.uf-insp .uf-ibtn{flex:1;text-align:center;height:32px;line-height:30px;border:1px solid var(--uf-line);
  border-radius:8px;
  background:var(--uf-surface);color:var(--uf-ink2);font-size:12px}
.uf-insp .uf-ibtn.pri{border-color:var(--uf-accent-line);color:var(--uf-accent);background:var(--uf-accent-soft)}
.uf-insp .uf-ibtn:hover{border-color:var(--uf-faint);color:var(--uf-ink)}
.uf-ilab2{color:var(--uf-dim);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  margin:0 0 6px}
.uf-iline{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-ink2);margin:3px 0;
  white-space:pre-wrap;word-break:break-word}
.uf-iline .uf-vn{color:var(--uf-dim)}
.uf-conn{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);cursor:pointer;margin-bottom:5px}
.uf-conn:hover{border-color:var(--uf-accent-line)}
.uf-conn .uf-arw{color:var(--uf-faint);font-size:12px;flex:none}
.uf-conn .uf-cn{font-size:12px;color:var(--uf-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-conn .uf-cl{color:var(--uf-faint);font-size:10px;margin-left:auto;font-family:ui-monospace,Menlo,monospace;
  flex:none}
.uf-conn .uf-cl+.uf-cl{margin-left:6px}
/* per-kind chip tint (W2): call/dep/count read as distinct species, not one grey blob */
.uf-conn .uf-cl.call{color:var(--uf-k-function)}
.uf-conn .uf-cl.dep{color:var(--uf-k-module)}
.uf-conn .uf-cl.calldep{color:var(--uf-k-type)}
.uf-conn .uf-cl.count{color:var(--uf-k-class)}
.uf-body{margin-top:4px;background:var(--uf-surface2);border:1px solid var(--uf-line);border-radius:8px;overflow:auto;
  max-height:320px}
.uf-body pre{margin:0;padding:11px 13px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.6;
  color:var(--uf-ink2);white-space:pre}
.uf-blk{padding:11px 16px;border-top:1px solid var(--uf-line)}

/* ---- v3 "stage": entrance stagger (approved motion contract) ---- */
.uf-card.uf-born{opacity:0;transform:translateY(10px) scale(.97)}
.uf-card.uf-in{opacity:1;transform:none;
  transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .65s cubic-bezier(.16,1,.3,1)}
.uf-wires path.uf-whit,.uf-swires path.uf-whit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;
  cursor:pointer}
.uf-wires path.uf-whov,.uf-swires path.uf-whov{stroke-opacity:.9}
.uf-wires path.uf-enter,.uf-swires path.uf-enter{stroke-dasharray:1;stroke-dashoffset:1;
  animation:ufDraw .9s cubic-bezier(.16,1,.3,1) forwards}
@keyframes ufDraw{to{stroke-dashoffset:0}}
.uf-wires path.uf-hot,.uf-swires path.uf-hot{stroke-dasharray:7 9;animation:ufFlow 1.1s linear infinite}
@keyframes ufFlow{to{stroke-dashoffset:-16}}
/* concealed-count badge on an aggregated wire: the aggregate admits what it
   hides; one click opens it (opt-in reveal, never default noise) */
.uf-wires g.uf-wb{cursor:pointer;pointer-events:auto}
.uf-wires g.uf-wb rect{fill:var(--uf-surface);stroke:var(--uf-line)}
.uf-wires g.uf-wb text{fill:var(--uf-dim);font:500 9px ui-monospace,Menlo,monospace}
.uf-wires g.uf-wb:hover rect{stroke:var(--uf-faint)}
.uf-wires g.uf-wb.hot rect{stroke:var(--uf-accent-line)}
.uf-wires g.uf-wb.hot text{fill:var(--uf-accent)}
.uf-wires g.uf-wb.dim{opacity:.18}

/* ---- v3 "stage": type focus ---- */
.uf-t{cursor:pointer;border-bottom:1px dotted var(--uf-faint)}
.uf-t:hover,.uf-t.hit{color:var(--uf-accent);border-bottom-color:var(--uf-accent)}
.uf-card.lit{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent-line)}

/* ---- v3 "stage": stage projection (world blurs behind; group center-stage) ---- */
.uf-world{transition:opacity .7s,filter .7s}
.uf-world.anim{transition:transform .7s cubic-bezier(.16,1,.3,1),opacity .7s,filter .7s}
.uf-world.anim2{transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .7s,filter .7s}
.uf-overlay.staged .uf-world{opacity:.16;filter:blur(5px) saturate(.6);pointer-events:none}
.uf-stagelayer{position:absolute;inset:0;z-index:10;pointer-events:none}
.uf-overlay.staged .uf-stagelayer{pointer-events:auto}
.uf-swires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}
.uf-sgroup{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);opacity:0;
  transition:opacity .75s cubic-bezier(.16,1,.3,1),transform .75s cubic-bezier(.16,1,.3,1);
  background:var(--uf-surface);border:1px solid var(--uf-line);border-radius:18px;
  padding:26px 30px 30px;max-width:720px;box-shadow:var(--uf-shadow-lift)}
.uf-overlay.staged .uf-sgroup{opacity:1;transform:translate(-50%,-50%)}
.uf-shead{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.uf-slabel{font-size:19px;font-weight:300;line-height:1}
.uf-strail{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--uf-faint)}
.uf-sleave{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-dim);padding:3px 9px;
  border-radius:6px}
.uf-sleave:hover{color:var(--uf-ink);background:var(--uf-hair)}
.uf-sbody{display:flex;flex-wrap:wrap;gap:11px;max-width:640px;max-height:70vh;overflow:auto}
.uf-proxy{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;
  background:var(--uf-surface);border:1px solid var(--uf-line);border-radius:99px;
  padding:8px 16px;display:flex;align-items:center;gap:9px;white-space:nowrap;
  box-shadow:var(--uf-shadow);font-family:ui-monospace,Menlo,monospace;font-size:12px;
  opacity:0;
  transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1),
  border-color .3s,border-radius .35s}
.uf-overlay.staged .uf-proxy{opacity:1}
.uf-proxy:hover{border-color:var(--uf-accent)}
.uf-pdot{width:7px;height:7px;border-radius:99px;background:var(--uf-accent);flex:none}
.uf-pgrp{color:var(--uf-faint);font-size:10px}
.uf-proxy.peek{border-radius:14px;white-space:normal;flex-direction:column;align-items:flex-start;gap:6px;
  padding:14px 16px;width:230px;cursor:default}
.uf-ptitle{font-weight:600}
.uf-pdesc{font-size:11px;line-height:1.5;color:var(--uf-ink2);font-family:Inter,-apple-system,sans-serif}
.uf-pdesc b{font-family:ui-monospace,Menlo,monospace}
.uf-ptravel{align-self:flex-end;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-accent);
  padding:4px 10px;border:1px solid var(--uf-accent-line);border-radius:99px;background:var(--uf-accent-soft)}
.uf-ptravel:hover{background:var(--uf-accent);color:var(--uf-surface)}
@media (prefers-reduced-motion:reduce){.uf-overlay *,.uf-wires path,.uf-swires path{animation:none!important;
  transition:none!important}}

/* ---- trust layer: advisory claims and edges are visibly weaker than code-backed ones ---- */
.uf-overlay.trust .uf-cdesc,.uf-overlay.trust .uf-idesc{border-left:2px solid var(--uf-k-store);padding-left:7px}
.uf-conn .uf-cl.adv{color:var(--uf-k-store)}
.uf-layer.off{opacity:.55;cursor:default}
.uf-layer.off .uf-sw{opacity:.4}
.uf-layer .uf-load{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--uf-accent);
  border:1px solid var(--uf-accent-line);border-radius:6px;padding:2px 7px;background:var(--uf-accent-soft);flex:none;
  cursor:pointer}

/* ---- rename in place ---- */
.uf-card .uf-cname[contenteditable]{outline:1px solid var(--uf-accent);border-radius:4px;padding:0 3px;
  white-space:normal;overflow:visible;text-overflow:clip;min-width:40px;
  user-select:text;-webkit-user-select:text}

/* ---- frontmatter editor mounted in the reading inspector ---- */
.uf-insp .fm-input{width:100%;border:1px solid var(--uf-line);border-radius:7px;background:var(--uf-surface);
  color:var(--uf-ink);font:inherit;font-size:12px;padding:5px 8px;margin:2px 0}
.uf-insp .fm-area{resize:vertical;min-height:40px}
.uf-insp .fm-listrow{display:flex;gap:5px;align-items:center}
.uf-insp .fm-listrow .fm-input{flex:1;min-width:0}
.uf-insp .fm-x,.uf-insp .fm-add{flex:none;color:var(--uf-dim);font-size:11px;border:1px solid var(--uf-line);
  border-radius:6px;padding:2px 7px;background:var(--uf-surface);cursor:pointer}
.uf-insp .fm-x:hover,.uf-insp .fm-add:hover{color:var(--uf-ink);border-color:var(--uf-faint)}
.uf-insp .fm-listhead{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.uf-insp .fm-listhead label{font-size:10px;color:var(--uf-dim);text-transform:uppercase;letter-spacing:.08em}
.uf-insp .insp-sec-title{display:flex;justify-content:space-between;color:var(--uf-dim);font-size:10.5px;
  font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.uf-insp .fm-hint{color:var(--uf-faint);font-weight:400;text-transform:none;letter-spacing:0}
.uf-insp .field{margin:6px 0}
.uf-insp .field label{display:block;font-size:10px;color:var(--uf-dim);text-transform:uppercase;letter-spacing:.08em;
  margin-bottom:2px}
.uf-insp .fm-iface{border:1px solid var(--uf-line);border-radius:8px;padding:8px;margin-top:8px}
.uf-insp .fm-iface-head .fm-iface-name{font-family:ui-monospace,Menlo,monospace}
.uf-insp .filebtn{margin-top:10px;font-size:11px;color:var(--uf-dim);border:1px solid var(--uf-line);
  border-radius:7px;padding:4px 10px;background:var(--uf-surface);cursor:pointer}
.uf-insp .filebtn:hover{color:var(--uf-ink);border-color:var(--uf-faint)}

/* ---- hidden-by-default model verbs: the '⋯' actions menu + connect mode (M5 A-verbs) ---- */
.uf-menu{display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--uf-line);
  border-radius:8px;background:var(--uf-surface)}
.uf-mitem{display:block;width:100%;text-align:left;padding:6px 9px;border-radius:6px;
  color:var(--uf-ink2);font-size:12px;transition:background .12s,color .12s}
.uf-mitem:hover{background:var(--uf-surface2);color:var(--uf-ink)}
.uf-mitem.danger{color:var(--uf-k-class)}
.uf-mrow{display:flex;gap:6px;padding:4px 3px}
.uf-minput{flex:1;min-width:0;border:1px solid var(--uf-line);border-radius:6px;background:var(--uf-surface);
  color:var(--uf-ink);font:inherit;font-size:11.5px;padding:5px 7px}
.uf-msep{border-top:1px solid var(--uf-hair);margin:3px 4px}
.uf-card.uf-armed{border-color:var(--uf-accent);box-shadow:0 0 0 2px var(--uf-accent-line)}
.uf-overlay.uf-connecting .uf-stage,.uf-overlay.uf-connecting .uf-card{cursor:crosshair}
`;
