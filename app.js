pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const {jsPDF} = window.jspdf;

// ── STATE ──
let pdfDoc=null, currentPage=1, totalPages=0, scale=1.5;
let allBoxes=[], boxCounter=0, exportFormat='cms';
let pageOriginalSizes={};

const COLORS=['#3d7eff','#ff5c7a','#00e5b0','#ffb545','#b47dff','#ff8c42','#4dd9e8','#ff6ec7'];
const RGBS  =['61,126,255','255,92,122','0,229,176','255,181,69','180,125,255','255,140,66','77,217,232','255,110,199'];

let signees=[
  {id:1,name:'Prospect Owner',color:COLORS[0],rgb:RGBS[0],order:1,type:1},
  {id:2,name:'Manager',        color:COLORS[1],rgb:RGBS[1],order:2,type:3},
  {id:3,name:'Client',         color:COLORS[2],rgb:RGBS[2],order:3,type:2},
];
let signeeCounter=3, activeSigneeId=1;
// DocumentID is auto-generated (random 4-digit) at export time
let currentTool='draw';
let isDrawing=false, startX, startY;
let isDragging=false, dragId=null, dragOX, dragOY;
let isMultiDrag=false, multiDragStartX, multiDragStartY, multiDragOrigins=[];
let multiClipboard=[]; // copied multi-selection
let previewMode=false; // global stamp preview toggle
let selectedId=null;
let multiSelected=new Set(); // ids of multi-selected boxes
let isMarquee=false, mqX0,mqY0,mqX1,mqY1; // marquee drag coords
let clipboard=null;
let ctxTargetId=null, ctxCX=0, ctxCY=0;

const pdfCanvas=document.getElementById('pdfCanvas');
const overlayCanvas=document.getElementById('overlayCanvas');
const drawCanvas=document.getElementById('drawCanvas');
const ctx=pdfCanvas.getContext('2d');
const octx=overlayCanvas.getContext('2d');
const dctx=drawCanvas.getContext('2d');

// ── DRAG & DROP FILE ──
const dz=document.getElementById('dropZone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f?.type==='application/pdf')loadPDFFromFile(f);});

// ── KEYBOARD ──
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='SELECT') return;
  if(e.key==='d'||e.key==='D') setTool('draw');
  if(e.key==='m'||e.key==='M') setTool('move');
  if(e.key==='s'||e.key==='S') setTool('multi');
  if(e.key==='Escape'){multiSelected.clear();updateAlignPanel();drawAllBoxes();}
  if((e.ctrlKey||e.metaKey)&&e.key==='c'){
    if(currentTool==='multi'&&multiSelected.size>0){copySelection();}
    else if(selectedId){clipboard={...allBoxes.find(b=>b.id===selectedId)};showToast('Box copied');}
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='v'){
    if(currentTool==='multi'&&multiClipboard.length>0){showPastePicker();}
    else if(clipboard){pasteBox(clipboard);}
  }
  if((e.key==='Delete'||e.key==='Backspace')&&selectedId) deleteBox(selectedId);
  if(selectedId||(currentTool==='multi'&&multiSelected.size>0)){
    // Arrow keys — prevent page scroll, move selection
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();
      const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
      const dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
      nudge(selectedId,dx,dy);
    }
  }
});

// ── SIGNEES ──
function renderSignees(){
  document.getElementById('signeeList').innerHTML=signees.map(s=>`
    <div class="signee-row ${s.id===activeSigneeId?'active':''}" style="--sc:${s.color}">
      <div class="signee-bar"></div>
      <div class="signee-inner" onclick="selSignee(${s.id})" style="cursor:pointer;">
        <div class="s-dot"></div>
        <span class="s-name">${s.name}</span>
        <span class="s-count" title="${allBoxes.filter(b=>b.signeeId===s.id).length} boxes">${allBoxes.filter(b=>b.signeeId===s.id).length}</span>
        ${signees.length>1?`<button class="s-del" onclick="event.stopPropagation();removeSignee(${s.id})" title="Remove signee">✕</button>`:''}
      </div>
      <div style="padding:4px 10px 10px 10px;display:flex;flex-direction:column;gap:5px;">
        <div style="display:flex;gap:5px;">
          <div style="flex:0 0 52px;">
            <div style="font-size:9px;color:var(--ink-4);letter-spacing:.5px;text-transform:uppercase;margin-bottom:3px;">Order</div>
            <input class="inp" type="number" min="1" value="${s.order||1}" style="padding:3px 5px;font-size:11px;font-family:var(--font-mono);width:100%;"
              onclick="event.stopPropagation()" onchange="event.stopPropagation();updSigneeOrder(${s.id},+this.value)">
          </div>
          <div style="flex:1;">
            <div style="font-size:9px;color:var(--ink-4);letter-spacing:.5px;text-transform:uppercase;margin-bottom:3px;">Signee Type</div>
            <select class="inp" style="padding:3px 5px;font-size:11px;width:100%;cursor:pointer;"
              onclick="event.stopPropagation()" onchange="event.stopPropagation();updSigneeType(${s.id},+this.value)">
              <option value="1" ${(s.type||1)===1?'selected':''}>Prospect Owner</option>
              <option value="2" ${(s.type||1)===2?'selected':''}>Client</option>
              <option value="3" ${(s.type||1)===3?'selected':''}>Manager</option>
            </select>
          </div>
        </div>
        <div style="font-size:9px;color:var(--ink-4);padding:3px 0;border-top:1px solid var(--border);margin-top:2px;">
          ${allBoxes.filter(b=>b.signeeId===s.id).length} field(s) configured
        </div>
      </div>
    </div>`).join('');
  updateBadge();
}
function updSigneeOrder(id,v){const s=signees.find(s=>s.id===id);if(s){s.order=v;updateExportPreview();}}
function updSigneeType(id,v){const s=signees.find(s=>s.id===id);if(s){s.type=v;updateExportPreview();}}
function selSignee(id){activeSigneeId=id;renderSignees();}
function addSignee(){
  const inp=document.getElementById('newSigneeName');
  const name=inp.value.trim(); if(!name) return;
  signeeCounter++;
  const idx=signees.length%COLORS.length;
  signees.push({id:signeeCounter,name,color:COLORS[idx],rgb:RGBS[idx],order:signees.length+1,type:1});
  activeSigneeId=signeeCounter; inp.value='';
  renderSignees();
}
function removeSignee(id){
  if(allBoxes.some(b=>b.signeeId===id))
    if(!confirm('Remove signee and all their boxes?')) return;
  allBoxes=allBoxes.filter(b=>b.signeeId!==id);
  signees=signees.filter(s=>s.id!==id);
  if(activeSigneeId===id) activeSigneeId=signees[0]?.id||null;
  renderSignees(); drawAllBoxes(); updatePanel();
}
function getSignee(id){return signees.find(s=>s.id===id);}
function updateBadge(){
  const s=getSignee(activeSigneeId);
  document.getElementById('abDot').style.background=s?.color||'#555';
  document.getElementById('abName').textContent=s?.name||'No signee';
  document.getElementById('hDot').style.background=s?.color||'#555';
}

// ── TOOLS ──
function setTool(t){
  currentTool=t;
  document.getElementById('toolDraw').classList.toggle('active',t==='draw');
  document.getElementById('toolMove').classList.toggle('active',t==='move');
  document.getElementById('toolMulti').classList.toggle('active',t==='multi');
  drawCanvas.style.cursor=t==='move'?'default':t==='multi'?'crosshair':'crosshair';
  if(t!=='multi'){multiSelected.clear();updateAlignPanel();}
  if(t!=='move'){selectedId=null;}
  drawAllBoxes();
}

// ── PDF LOAD ──
async function loadPDF(inp){const f=inp.files[0];if(!f)return;loadPDFFromFile(f);inp.value='';}
async function loadPDFFromFile(file){
  document.getElementById('filenameBadge').textContent=file.name;
  allBoxes=[];boxCounter=0;pageOriginalSizes={};updatePanel();
  const buf=await file.arrayBuffer();
  pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
  totalPages=pdfDoc.numPages; currentPage=1;
  for(let i=1;i<=totalPages;i++){
    const pg=await pdfDoc.getPage(i);
    const vp=pg.getViewport({scale:1});
    pageOriginalSizes[i]={width:vp.width,height:vp.height};
  }
  document.getElementById('dropZone').style.display='none';
  document.getElementById('pdfWrap').style.display='flex';
  document.getElementById('pdfToolbar').style.display='flex';
  document.getElementById('hintBar').style.display='flex';
  document.getElementById('importJsonBtn').disabled=false;
  await renderPage(currentPage); fitToWidth();
}

async function renderPage(num){
  commitInlineEdit(); // close any open inline editor before re-rendering
  const page=await pdfDoc.getPage(num);
  // Use device pixel ratio for crisp rendering
  const dpr=window.devicePixelRatio||1;
  const vp=page.getViewport({scale});
  const cssW=vp.width, cssH=vp.height;

  // Physical size (retina-aware)
  pdfCanvas.width=Math.floor(cssW*dpr);
  pdfCanvas.height=Math.floor(cssH*dpr);
  pdfCanvas.style.width=cssW+'px';
  pdfCanvas.style.height=cssH+'px';

  overlayCanvas.width=Math.floor(cssW*dpr);
  overlayCanvas.height=Math.floor(cssH*dpr);
  overlayCanvas.style.width=cssW+'px';
  overlayCanvas.style.height=cssH+'px';

  drawCanvas.width=Math.floor(cssW*dpr);
  drawCanvas.height=Math.floor(cssH*dpr);
  drawCanvas.style.width=cssW+'px';
  drawCanvas.style.height=cssH+'px';

  // Scale context for DPR
  ctx.setTransform(dpr,0,0,dpr,0,0);
  octx.setTransform(dpr,0,0,dpr,0,0);
  dctx.setTransform(dpr,0,0,dpr,0,0);

  await page.render({canvasContext:ctx,viewport:vp}).promise;
  drawAllBoxes();
  updatePageNav();
}

// ── DRAW BOXES ──
function drawAllBoxes(){
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  allBoxes.filter(b=>b.page===currentPage).forEach(box=>{
    const s=getSignee(box.signeeId);
    const color=s?.color||'#3d7eff';
    const bx=box.x*scale, by=box.y*scale, bw=box.w*scale, bh=box.h*scale;
    const sel=box.id===selectedId;
    const multi=multiSelected.has(box.id);

    if(previewMode){
      // ── PREVIEW MODE: barely-there box visuals so document lines show through ──
      // (signature fields skip this — they render as a full signature block below)
      if((box.fieldType||0)!==0){
        octx.fillStyle=hex2rgba(color,0.035);
        octx.fillRect(bx,by,bw,bh);
        octx.strokeStyle=hex2rgba(color,0.28);
        octx.lineWidth=1;
        octx.setLineDash([]);
        octx.strokeRect(bx,by,bw,bh);
      }
      // No labels, no selection chrome — clean stamp inspection view
    } else {
      octx.fillStyle=hex2rgba(color,multi?.25:sel?.2:.1);
      octx.fillRect(bx,by,bw,bh);
      octx.strokeStyle=multi?'#fff':color;
      octx.lineWidth=multi?2.5:sel?2.5:1.5;
      octx.setLineDash(multi?[5,3]:sel?[6,3]:[]);
      octx.strokeRect(bx,by,bw,bh);
      // multi-selected: draw corner handles
      if(multi){
        octx.setLineDash([]);
        octx.fillStyle=color;
        const hs=5;
        [[bx,by],[bx+bw-hs,by],[bx,by+bh-hs],[bx+bw-hs,by+bh-hs]].forEach(([hx,hy])=>{
          octx.fillRect(hx,hy,hs,hs);
        });
      }
      octx.setLineDash([]);
      // Only draw label if the box is tall enough (>18px rendered) and wide enough to fit text
      octx.font='bold 10px Inter,sans-serif';
      const lbl=box.name;
      const tw=octx.measureText(lbl).width+8;
      if(bh>18 && bw>tw){
        octx.fillStyle=color; octx.fillRect(bx,by,tw,16);
        octx.fillStyle='#fff'; octx.fillText(lbl,bx+4,by+11);
      }
    }

    // ── STAMP PREVIEW — renders exactly as the real stamp engine would ──
    // Text & date fields: Arial 8pt · Checkbox: Adobe Pi Std 7pt check mark
    {
      const ft = box.fieldType||0;
      let ptxt = (box.previewText||'').trim();

      // Preview Mode: auto-fill sample stamps for boxes with no typed text
      if(previewMode && !ptxt){
        if(ft===2)      ptxt = previewDateString();     // Date Auto Stamp → today
        else if(ft===9) ptxt = '✔';                     // Check Box → check mark
        else if(ft===5||ft===6) ptxt = box.name;        // Plain text → field name as sample
        // Signature (0) has no text stamp — skipped
      }

      // Checkbox fields ALWAYS stamp a check mark, whatever was typed
      if(ft===9 && ptxt) ptxt = '✔';

      if(previewMode && ft===0){
        // Signature fields render the full CMS Sign signature block
        drawSignatureBlock(octx, bx, by, bw, bh);
      } else if(ptxt){
        const isCheck = ft===9;
        // Real stamp specs: checkbox = Adobe Pi Std 7pt, everything else = Arial 8pt
        const fontPt = isCheck ? 7 : 8;
        const stampFontPx = fontPt * scale;
        octx.save();
        octx.font = isCheck
          ? `${stampFontPx}px "Adobe Pi Std", "ZapfDingbats", "Segoe UI Symbol", sans-serif`
          : `${stampFontPx}px Arial, sans-serif`;
        octx.fillStyle = '#000';
        octx.textBaseline = 'alphabetic';
        octx.beginPath();
        octx.rect(bx, by, bw, bh);
        octx.clip();
        const textY = by + (bh/2) + (stampFontPx*0.35);
        if(isCheck){
          // Check marks stamp centred in the box
          octx.textAlign = 'center';
          octx.fillText(ptxt, bx + bw/2, textY);
        } else {
          octx.textAlign = 'left';
          octx.fillText(ptxt, bx + 2*scale, textY);
        }
        octx.restore();
        // Faint baseline hint = live preview indicator (hidden in Preview Mode for a clean view)
        if(!previewMode){
          octx.strokeStyle = hex2rgba('#000000', 0.15);
          octx.setLineDash([2,2]);
          octx.lineWidth = 1;
          octx.beginPath();
          octx.moveTo(bx+1, by+bh-1);
          octx.lineTo(bx+bw-1, by+bh-1);
          octx.stroke();
          octx.setLineDash([]);
        }
      }
    }
  });
  // draw marquee rectangle
  if(isMarquee){
    const rx=Math.min(mqX0,mqX1),ry=Math.min(mqY0,mqY1);
    const rw=Math.abs(mqX1-mqX0),rh=Math.abs(mqY1-mqY0);
    octx.strokeStyle='rgba(255,255,255,0.8)'; octx.lineWidth=1.5; octx.setLineDash([5,3]);
    octx.strokeRect(rx,ry,rw,rh);
    octx.fillStyle='rgba(61,126,255,0.12)'; octx.fillRect(rx,ry,rw,rh);
    octx.setLineDash([]);
  }
}
function hex2rgba(hex,a){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`rgba(${r},${g},${b},${a})`;}

// ── CANVAS MOUSE ──
function getCanvasXY(e){
  const r=drawCanvas.getBoundingClientRect();
  return[e.clientX-r.left,e.clientY-r.top];
}
function boxAt(cx,cy){
  const pg=allBoxes.filter(b=>b.page===currentPage);
  for(let i=pg.length-1;i>=0;i--){
    const b=pg[i];
    if(cx>=b.x*scale&&cx<=(b.x+b.w)*scale&&cy>=b.y*scale&&cy<=(b.y+b.h)*scale) return b;
  }
  return null;
}

drawCanvas.addEventListener('mousedown',e=>{
  if(e.button===2) return;
  const[cx,cy]=getCanvasXY(e);
  const hit=boxAt(cx,cy);

  // ── Preview mode: click to type into text/date fields, toggle checkboxes ──
  if(previewMode){
    commitInlineEdit();
    if(hit){
      const ft=hit.fieldType||0;
      if(ft===5||ft===6||ft===2){ showInlineEdit(hit); }
      else if(ft===9){ hit.previewText=hit.previewText?'':'✔'; drawAllBoxes(); updatePanel(); }
    }
    return;
  }

  if(currentTool==='multi'){
    if(hit){
      if(multiSelected.has(hit.id)){
        // Already selected — start a group drag
        isMultiDrag=true;
        multiDragStartX=cx; multiDragStartY=cy;
        multiDragOrigins=getSelectedBoxes().map(b=>({id:b.id,x:b.x,y:b.y}));
        drawCanvas.style.cursor='grabbing';
      } else {
        // Not selected — toggle into selection
        multiSelected.add(hit.id);
        updateAlignPanel(); drawAllBoxes(); updatePanel();
      }
    } else {
      // Empty space — start marquee
      isMarquee=true; mqX0=cx; mqY0=cy; mqX1=cx; mqY1=cy;
    }
    return;
  }

  // Click on a box in draw/move mode → switch to move, select it
  if(hit){
    setTool('move');
    selectedId=hit.id;
    isDragging=true; dragId=hit.id;
    dragOX=cx-hit.x*scale; dragOY=cy-hit.y*scale;
    drawCanvas.style.cursor='grabbing';
    drawAllBoxes(); updatePanel(); scrollCard(hit.id);
    return;
  }

  // Click on empty area while in move mode → switch back to draw
  if(currentTool==='move'){
    setTool('draw'); selectedId=null; drawAllBoxes(); return;
  }

  // Draw mode
  if(!activeSigneeId){showToast('Select a signee first');return;}
  startX=cx; startY=cy; isDrawing=true;
  document.getElementById('liveCur').style.display='flex';
});

drawCanvas.addEventListener('mousemove',e=>{
  const[cx,cy]=getCanvasXY(e);
  document.getElementById('lX').textContent=Math.round(cx/scale);
  document.getElementById('lY').textContent=Math.round(cy/scale);

  if(previewMode){
    const h=boxAt(cx,cy);
    const ftc=h?(h.fieldType||0):-1;
    drawCanvas.style.cursor=(ftc===5||ftc===6||ftc===2)?'text':(ftc===9?'pointer':'default');
    return;
  }

  if(currentTool==='move'&&!isDragging){
    drawCanvas.style.cursor=boxAt(cx,cy)?'grab':'crosshair';
  }
  if(currentTool==='multi'&&!isMultiDrag&&!isMarquee){
    const h=boxAt(cx,cy);
    drawCanvas.style.cursor=(h&&multiSelected.has(h.id))?'grab':'crosshair';
  }

  if(isMarquee){
    mqX1=cx; mqY1=cy; drawAllBoxes(); return;
  }

  if(isMultiDrag){
    const dx=Math.round((cx-multiDragStartX)/scale);
    const dy=Math.round((cy-multiDragStartY)/scale);
    multiDragOrigins.forEach(o=>{
      const b=allBoxes.find(b=>b.id===o.id);
      if(b){b.x=Math.max(0,o.x+dx);b.y=Math.max(0,o.y+dy);}
    });
    drawAllBoxes(); return;
  }

  if(isDragging&&dragId){
    const box=allBoxes.find(b=>b.id===dragId);
    if(box){box.x=Math.max(0,Math.round((cx-dragOX)/scale));box.y=Math.max(0,Math.round((cy-dragOY)/scale));drawAllBoxes();patchCard(box.id);}
    return;
  }
  if(!isDrawing) return;

  dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
  const rw=cx-startX, rh=cy-startY;
  const s=getSignee(activeSigneeId);
  const color=s?.color||'#3d7eff';
  dctx.strokeStyle=color; dctx.lineWidth=2; dctx.setLineDash([6,3]);
  dctx.strokeRect(startX,startY,rw,rh);
  dctx.fillStyle=hex2rgba(color,.08); dctx.fillRect(startX,startY,rw,rh);
  dctx.setLineDash([]);
  dctx.fillStyle=hex2rgba(color,.9); dctx.font='bold 10px IBM Plex Mono,monospace';
  const wl=Math.abs(Math.round(rw/scale)),hl=Math.abs(Math.round(rh/scale));
  dctx.fillText(`${wl}×${hl}`,startX+4,startY+(rh>16?rh-4:-5));
});

drawCanvas.addEventListener('mouseup',e=>{
  if(isMultiDrag){
    isMultiDrag=false; multiDragOrigins=[];
    drawCanvas.style.cursor='crosshair';
    updatePanel(); return;
  }
  if(isMarquee){
    isMarquee=false;
    // Select all boxes whose centres fall inside the marquee rect
    const rx0=Math.min(mqX0,mqX1)/scale, ry0=Math.min(mqY0,mqY1)/scale;
    const rx1=Math.max(mqX0,mqX1)/scale, ry1=Math.max(mqY0,mqY1)/scale;
    allBoxes.filter(b=>b.page===currentPage).forEach(b=>{
      const cx2=b.x+b.w/2, cy2=b.y+b.h/2;
      if(cx2>=rx0&&cx2<=rx1&&cy2>=ry0&&cy2<=ry1) multiSelected.add(b.id);
    });
    updateAlignPanel(); drawAllBoxes(); updatePanel(); return;
  }
  if(isDragging){isDragging=false;dragId=null;drawCanvas.style.cursor='grab';updatePanel();return;}
  if(!isDrawing) return;
  isDrawing=false;
  document.getElementById('liveCur').style.display='none';
  dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
  const[ex,ey]=getCanvasXY(e);
  const rawX=Math.min(startX,ex),rawY=Math.min(startY,ey);
  const rawW=Math.abs(ex-startX),rawH=Math.abs(ey-startY);
  if(rawW<8||rawH<8) return;
  boxCounter++;
  const s=getSignee(activeSigneeId);
  const box={id:boxCounter,name:`${s?.name||'Sign'}_${boxCounter}`,signeeId:activeSigneeId,page:currentPage,
    x:Math.round(rawX/scale),y:Math.round(rawY/scale),w:Math.round(rawW/scale),h:Math.round(rawH/scale),
    fieldType:0};  // 0=Sign, 2=Date Auto Stamp, 5=Text Field
  allBoxes.push(box); selectedId=box.id;
  drawAllBoxes(); updatePanel(); renderSignees(); scrollCard(box.id);
});

drawCanvas.addEventListener('mouseleave',()=>{
  document.getElementById('liveCur').style.display='none';
  if(isDrawing){isDrawing=false;dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);}
  if(isMarquee){isMarquee=false;drawAllBoxes();}
  if(isMultiDrag){isMultiDrag=false;multiDragOrigins=[];drawCanvas.style.cursor='crosshair';}
});

// ── CONTEXT MENU ──
drawCanvas.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const[cx,cy]=getCanvasXY(e);
  ctxCX=Math.round(cx/scale); ctxCY=Math.round(cy/scale);
  const box=boxAt(cx,cy);
  ctxTargetId=box?box.id:null;
  if(box){selectedId=box.id;drawAllBoxes();}
  const m=document.getElementById('ctxMenu');
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';
  m.classList.add('show');
});
document.addEventListener('click',closeCtx);
function closeCtx(){document.getElementById('ctxMenu').classList.remove('show');}

function ctxCopy(){if(!ctxTargetId)return;clipboard={...allBoxes.find(b=>b.id===ctxTargetId)};showToast('Box copied');}
function ctxPaste(){if(!clipboard){showToast('Nothing to paste');return;}pasteBox(clipboard,ctxCX,ctxCY);}
function ctxDuplicate(){
  if(!ctxTargetId)return;
  const src=allBoxes.find(b=>b.id===ctxTargetId); if(!src)return;
  boxCounter++;
  allBoxes.push({...src,id:boxCounter,name:src.name+'_copy',x:src.x+10,y:src.y+10});
  selectedId=boxCounter; drawAllBoxes(); updatePanel(); renderSignees(); showToast('Duplicated');
}
function ctxDuplicateAll(){
  if(!ctxTargetId)return;
  const src=allBoxes.find(b=>b.id===ctxTargetId); if(!src)return;
  for(let p=1;p<=totalPages;p++){if(p===src.page)continue;boxCounter++;allBoxes.push({...src,id:boxCounter,page:p});}
  updatePanel(); renderSignees(); showToast(`Duplicated to all ${totalPages} pages`);
}
function ctxDelete(){if(ctxTargetId)deleteBox(ctxTargetId);}

function pasteBox(src,atX,atY){
  boxCounter++;
  const copy={...src,id:boxCounter,page:currentPage,x:atX??src.x+10,y:atY??src.y+10,name:src.name+'_paste'};
  allBoxes.push(copy); selectedId=copy.id;
  drawAllBoxes(); updatePanel(); renderSignees(); showToast('Pasted');
}
function nudge(id,dx,dy){
  if(currentTool==='multi'&&multiSelected.size>0){
    // Move all selected
    getSelectedBoxes().forEach(b=>{b.x=Math.max(0,b.x+dx);b.y=Math.max(0,b.y+dy);});
    drawAllBoxes(); updatePanel(); return;
  }
  const b=allBoxes.find(b=>b.id===id); if(!b)return;
  b.x=Math.max(0,b.x+dx); b.y=Math.max(0,b.y+dy);
  drawAllBoxes(); patchCard(id);
}

// ── MULTI-SELECT ALIGN ──
function updateAlignPanel(){
  const sec=document.getElementById('alignSection');
  const cnt=document.getElementById('selCount');
  const n=multiSelected.size;
  if(n>=2){
    sec.style.display='block';
    cnt.textContent=`(${n} selected)`;
    // Pre-fill W/H with common value if all selected boxes share one
    const boxes=getSelectedBoxes();
    const ws=[...new Set(boxes.map(b=>b.w))];
    const hs=[...new Set(boxes.map(b=>b.h))];
    const wInp=document.getElementById('bulkW');
    const hInp=document.getElementById('bulkH');
    if(wInp) wInp.value=ws.length===1?ws[0]:'';
    if(hInp) hInp.value=hs.length===1?hs[0]:'';
  } else {
    sec.style.display='none';
    // Hide paste picker when selection cleared
    const pp=document.getElementById('pastePicker');
    if(pp) pp.style.display='none';
  }
}

function getSelectedBoxes(){
  return allBoxes.filter(b=>multiSelected.has(b.id));
}

function copySelection(){
  const boxes=getSelectedBoxes();
  if(!boxes.length) return;
  // Store deep copies
  multiClipboard=boxes.map(b=>({...b}));
  // Show paste button and toast
  document.getElementById('pasteSelBtn').style.display='inline-flex';
  document.getElementById('pastePicker').style.display='none';
  showToast(`${multiClipboard.length} box(es) copied — click "Paste to…" to choose a page`);
}

function showPastePicker(){
  if(!multiClipboard.length){showToast('Nothing copied yet');return;}
  const picker=document.getElementById('pastePicker');
  const btns=document.getElementById('pastePageBtns');
  // Build one button per page
  let btnHTML='';
  for(let p=1;p<=totalPages;p++){
    const isCurrent=p===currentPage;
    btnHTML+=`<button class="align-btn wide" onclick="pasteSelectionToPage(${p})"
      style="padding:5px 8px;${isCurrent?'border-color:var(--mint);color:var(--mint);':''}">
      PG ${p}${isCurrent?' ★':''}
    </button>`;
  }
  btns.innerHTML=btnHTML;
  picker.style.display=picker.style.display==='none'?'block':'none';
}

function pasteSelectionToPage(targetPage){
  if(!multiClipboard.length) return;
  const newIds=[];
  multiClipboard.forEach(src=>{
    boxCounter++;
    allBoxes.push({...src, id:boxCounter, page:targetPage});
    newIds.push(boxCounter);
  });
  // Select the newly pasted boxes
  multiSelected.clear();
  newIds.forEach(id=>multiSelected.add(id));
  // Navigate to target page and render
  currentPage=targetPage;
  renderPage(currentPage).then(()=>{
    updatePanel(); renderSignees(); updateAlignPanel();
    // Hide picker after pasting
    document.getElementById('pastePicker').style.display='none';
    showToast(`${multiClipboard.length} box(es) pasted onto page ${targetPage}`);
  });
}

function bulkNudge(dx,dy){
  getSelectedBoxes().forEach(b=>{b.x=Math.max(0,b.x+dx);b.y=Math.max(0,b.y+dy);});
  drawAllBoxes(); updatePanel();
}

function applyBulkSize(dim){
  const val=parseInt(dim==='w'?document.getElementById('bulkW').value:document.getElementById('bulkH').value);
  if(!val||val<1){showToast('Enter a valid value first');return;}
  getSelectedBoxes().forEach(b=>{if(dim==='w')b.w=val;else b.h=val;});
  drawAllBoxes(); updatePanel();
  showToast(`${dim==='w'?'Width':'Height'} set to ${val}px for ${multiSelected.size} box(es)`);
}

function alignBoxes(dir){
  const boxes=getSelectedBoxes(); if(boxes.length<2) return;
  const xs=boxes.map(b=>b.x), ys=boxes.map(b=>b.y);
  const rights=boxes.map(b=>b.x+b.w), bottoms=boxes.map(b=>b.y+b.h);
  const minX=Math.min(...xs), maxRight=Math.max(...rights);
  const minY=Math.min(...ys), maxBottom=Math.max(...bottoms);
  const midX=Math.round((minX+maxRight)/2), midY=Math.round((minY+maxBottom)/2);
  boxes.forEach(b=>{
    if(dir==='left')    b.x=minX;
    if(dir==='right')   b.x=maxRight-b.w;
    if(dir==='centerH') b.x=midX-Math.round(b.w/2);
    if(dir==='top')     b.y=minY;
    if(dir==='bottom')  b.y=maxBottom-b.h;
    if(dir==='centerV') b.y=midY-Math.round(b.h/2);
  });
  drawAllBoxes(); updatePanel();
  const labels={left:'Left',right:'Right',centerH:'Center H',top:'Top',bottom:'Bottom',centerV:'Center V'};
  showToast(`Aligned ${labels[dir]}`);
}

function distributeBoxes(axis){
  const boxes=getSelectedBoxes(); if(boxes.length<3){showToast('Need 3+ boxes to distribute');return;}
  if(axis==='h'){
    boxes.sort((a,b)=>a.x-b.x);
    const first=boxes[0].x, last=boxes[boxes.length-1].x+boxes[boxes.length-1].w;
    const totalW=boxes.reduce((s,b)=>s+b.w,0);
    const gap=Math.round((last-first-totalW)/(boxes.length-1));
    let cur=first;
    boxes.forEach(b=>{b.x=cur;cur+=b.w+gap;});
  } else {
    boxes.sort((a,b)=>a.y-b.y);
    const first=boxes[0].y, last=boxes[boxes.length-1].y+boxes[boxes.length-1].h;
    const totalH=boxes.reduce((s,b)=>s+b.h,0);
    const gap=Math.round((last-first-totalH)/(boxes.length-1));
    let cur=first;
    boxes.forEach(b=>{b.y=cur;cur+=b.h+gap;});
  }
  drawAllBoxes(); updatePanel(); showToast('Distributed');
}

function deleteSelected(){
  if(!multiSelected.size) return;
  if(!confirm(`Delete ${multiSelected.size} selected box(es)?`)) return;
  allBoxes=allBoxes.filter(b=>!multiSelected.has(b.id));
  multiSelected.clear(); updateAlignPanel();
  drawAllBoxes(); updatePanel(); renderSignees();
}

// ── PAGE NAV ──
function changePage(dir){const n=currentPage+dir;if(n<1||n>totalPages)return;currentPage=n;renderPage(currentPage);}
function updatePageNav(){
  document.getElementById('pageCtr').textContent=`${currentPage} / ${totalPages}`;
  document.getElementById('prevBtn').disabled=currentPage<=1;
  document.getElementById('nextBtn').disabled=currentPage>=totalPages;
}
function changeZoom(d){scale=Math.max(.4,Math.min(3,scale+d));document.getElementById('zoomLbl').textContent=Math.round(scale*100)+'%';if(pdfDoc)renderPage(currentPage);}
function fitToWidth(){
  const wrap=document.getElementById('pdfWrap');
  const w=wrap.clientWidth-48;
  if(pdfDoc&&pageOriginalSizes[currentPage]){
    scale=Math.round((w/pageOriginalSizes[currentPage].width)*100)/100;
    document.getElementById('zoomLbl').textContent=Math.round(scale*100)+'%';
    renderPage(currentPage);
  }
}

// ── PANEL ──
function updatePanel(){
  const list=document.getElementById('coordsList');
  const empty=document.getElementById('emptyState');
  document.getElementById('countBadge').textContent=allBoxes.length;
  const hasBoxes=allBoxes.length>0;
  document.getElementById('exportBtn').disabled=!hasBoxes;
  document.getElementById('copyBtn').disabled=!hasBoxes;
  document.getElementById('pdfBtn').disabled=!hasBoxes;
  const jb=document.getElementById('jsonDlBtn');
  jb.disabled=!hasBoxes;
  jb.style.display=(exportFormat==='cms')?'inline-flex':'none';
  if(!hasBoxes){list.style.display='none';empty.style.display='flex';document.getElementById('expPreview').textContent='// Draw boxes to see coordinates';return;}
  list.style.display='block'; empty.style.display='none';
  const sorted=[...allBoxes].sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id);
  list.innerHTML=sorted.map(box=>{
    const s=getSignee(box.signeeId);
    const color=s?.color||'#3d7eff';
    const sel=box.id===selectedId;
    const signeeOptions=signees.map(sig=>`<option value="${sig.id}" ${sig.id===box.signeeId?'selected':''}>${sig.name}</option>`).join('');
    return`<div class="coord-card ${sel?'selected':''}" id="card-${box.id}" style="--sc:${color}" onclick="selCard(${box.id})">
      <div class="card-sel-banner">✎ Currently Editing</div>
      <div class="card-bar"></div>
      <div class="card-body">
        <div class="card-head">
          <div class="card-dot"></div>
          <input class="card-name" value="${box.name}" onchange="updName(${box.id},this.value)" onclick="event.stopPropagation()" placeholder="Field name…"/>
          <span class="pg-badge">PG ${box.page}</span>
          <div class="card-acts">
            <button class="btn btn-icon btn-sm btn-ghost" title="Copy" onclick="event.stopPropagation();copyCard(${box.id})">📋</button>
            <button class="btn btn-icon btn-sm btn-danger" title="Delete" onclick="event.stopPropagation();deleteBox(${box.id})">✕</button>
          </div>
        </div>
        <select class="card-signee-sel" onchange="updSignee(${box.id},+this.value)" onclick="event.stopPropagation()" style="border-left:3px solid ${color}">
          ${signeeOptions}
        </select>
        <div class="cf-grid">
          <div class="cf"><div class="cf-lbl">X</div><input class="cf-inp" type="number" value="${box.x}" onchange="updCoord(${box.id},'x',+this.value)" onclick="event.stopPropagation()"></div>
          <div class="cf"><div class="cf-lbl">Y</div><input class="cf-inp" type="number" value="${box.y}" onchange="updCoord(${box.id},'y',+this.value)" onclick="event.stopPropagation()"></div>
          <div class="cf"><div class="cf-lbl">WIDTH</div><input class="cf-inp" type="number" value="${box.w}" onchange="updCoord(${box.id},'w',+this.value)" onclick="event.stopPropagation()"></div>
          <div class="cf"><div class="cf-lbl">HEIGHT</div><input class="cf-inp" type="number" value="${box.h}" onchange="updCoord(${box.id},'h',+this.value)" onclick="event.stopPropagation()"></div>
        </div>
        <div style="margin-top:5px;">
          <div class="cf-lbl" style="margin-bottom:3px;">FIELD TYPE</div>
          <select class="card-signee-sel" style="border-left:3px solid ${color};font-family:var(--sans);font-size:11px;"
            onchange="updFieldType(${box.id},+this.value)" onclick="event.stopPropagation()">
            <option value="0" ${(box.fieldType||0)===0?'selected':''}>Signature</option>
            <option value="2" ${(box.fieldType||0)===2?'selected':''}>Date Auto Stamp</option>
            <option value="5" ${(box.fieldType||0)===5?'selected':''}>Plain Text (Mandatory)</option>
            <option value="6" ${(box.fieldType||0)===6?'selected':''}>Plain Text (Optional)</option>
            <option value="9" ${(box.fieldType||0)===9?'selected':''}>Check Box</option>
          </select>
        </div>
        <div style="margin-top:6px;">
          <div class="cf-lbl" style="margin-bottom:3px;display:flex;align-items:center;gap:5px;">
            PREVIEW TEXT <span style="color:var(--ink-4);font-weight:400;text-transform:none;letter-spacing:0;font-size:9px;">${(box.fieldType||0)===9?'(stamps ✔ — Adobe Pi Std 7pt)':'(Arial 8pt stamp preview)'}</span>
          </div>
          <input class="inp" value="${(box.previewText||'').replace(/"/g,'&quot;')}"
            placeholder="Type to preview…"
            style="width:100%;padding:5px 8px;font-size:11px;font-family:Arial,sans-serif;"
            oninput="updPreviewText(${box.id},this.value)" onclick="event.stopPropagation()">
        </div>
      </div>
    </div>`;
  }).join('');
  updateExportPreview();
}

function selCard(id){
  selectedId=id;
  const box=allBoxes.find(b=>b.id===id);
  if(box&&box.page!==currentPage){currentPage=box.page;renderPage(currentPage);}
  else drawAllBoxes();
  document.querySelectorAll('.coord-card').forEach(c=>c.classList.toggle('selected',c.id===`card-${id}`));
}
function scrollCard(id){setTimeout(()=>{const el=document.getElementById(`card-${id}`);if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});},60);}
function copyCard(id){clipboard={...allBoxes.find(b=>b.id===id)};showToast('Box copied — Ctrl+V or right-click to paste');}
function updName(id,v){const b=allBoxes.find(b=>b.id===id);if(b){b.name=v;drawAllBoxes();updateExportPreview();}}
function updSignee(id,sid){
  const b=allBoxes.find(b=>b.id===id); if(!b)return;
  b.signeeId=sid;
  // update card colour
  const s=getSignee(sid);
  const card=document.getElementById(`card-${id}`);
  if(card&&s){card.style.setProperty('--sc',s.color);card.querySelector('.card-dot').style.background=s.color;card.querySelector('.card-signee-sel').style.borderLeft=`3px solid ${s.color}`;}
  drawAllBoxes(); renderSignees(); updateExportPreview();
}
function updCoord(id,f,v){const b=allBoxes.find(b=>b.id===id);if(b){b[f]=Math.max(0,v||0);drawAllBoxes();updateExportPreview();}}
function updFieldType(id,v){const b=allBoxes.find(b=>b.id===id);if(b){b.fieldType=v;updateExportPreview();}}
function updPreviewText(id,v){const b=allBoxes.find(b=>b.id===id);if(b){b.previewText=v;drawAllBoxes();}}
function togglePreviewMode(){
  previewMode=!previewMode;
  if(!previewMode) commitInlineEdit();
  const b=document.getElementById('previewToggleBtn');
  if(b){
    b.classList.toggle('btn-primary',previewMode);
    b.textContent=previewMode?'👁 Preview ON':'👁 Preview';
  }
  const ht=document.getElementById('hintText');
  if(ht) ht.textContent=previewMode
    ?'Preview: click any text or date field to type into it · click a checkbox to toggle ✔ · signature fields show the stamp block'
    :'Draw: drag to create box. Move: click box to drag. Multi-Select: drag marquee or click boxes, then align.';
  drawAllBoxes();
  showToast(previewMode
    ?'Preview ON — sample stamps shown (dates, ✔ marks, field names)'
    :'Preview off');
}

function previewDateString(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}`;
}

function roundRectPath(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  c.moveTo(x+r,y);
  c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r);
  c.arcTo(x,y,x+w,y,r);
  c.closePath();
}

// Handwritten-style scrawl, drawn with beziers, scaled to the box
function drawSignatureScrawl(c,x,y,w,h){
  const cx=x+w*0.48, cy=y+h*0.56;
  const s=Math.min(w*0.6,h*1.5);
  c.save();
  c.translate(cx,cy);
  c.lineWidth=Math.max(1.5,h*0.07);
  c.lineCap='round'; c.lineJoin='round';
  c.strokeStyle='#111';
  c.beginPath();
  c.moveTo(-s*0.30,s*0.12);
  c.bezierCurveTo(-s*0.27,-s*0.18,-s*0.13,-s*0.22,-s*0.11,-s*0.02);
  c.bezierCurveTo(-s*0.09,s*0.15,-s*0.19,s*0.17,-s*0.15,s*0.04);
  c.bezierCurveTo(-s*0.11,-s*0.09,-s*0.01,-s*0.24,s*0.03,-s*0.06);
  c.bezierCurveTo(s*0.06,s*0.07,-s*0.01,s*0.13,s*0.04,s*0.11);
  c.bezierCurveTo(s*0.11,s*0.08,s*0.13,-s*0.02,s*0.19,s*0.02);
  c.bezierCurveTo(s*0.25,s*0.07,s*0.31,s*0.02,s*0.35,s*0.05);
  c.stroke();
  c.restore();
}

// The full CMS Sign signature block — matches the real stamp output:
// rounded border, blue "Signature" legend on the top edge, scrawl, powered-by footer
function drawSignatureBlock(c,bx,by,bw,bh){
  c.save();
  const r=Math.min(5*scale, bh*0.18);

  // White field + border
  c.beginPath();
  roundRectPath(c,bx+0.5,by+0.5,bw-1,bh-1,r);
  c.fillStyle='#ffffff';
  c.fill();
  c.lineWidth=Math.max(1, scale);
  c.strokeStyle='#3a3f4a';
  c.stroke();

  // "Signature" legend sitting on the top border (fieldset style)
  const labelFont=Math.max(6, Math.min(8*scale, bh*0.24));
  c.font=`600 ${labelFont}px Arial, sans-serif`;
  const label='Signature';
  const lw=c.measureText(label).width;
  const lx=bx+10*scale;
  c.fillStyle='#ffffff';
  c.fillRect(lx-4*scale, by-labelFont*0.6, lw+8*scale, labelFont*1.2);
  c.fillStyle='#2f479c';
  c.textAlign='left';
  c.textBaseline='middle';
  c.fillText(label,lx,by+0.5);

  // The scrawl
  drawSignatureScrawl(c,bx,by,bw,bh);

  // "Powered by ● CMS Sign" — sits ON the bottom border line (legend style, like the real stamp)
  const pf=Math.max(4, Math.min(5*scale, bh*0.15));
  c.font=`${pf}px Arial, sans-serif`;
  c.textAlign='right';
  c.textBaseline='middle';
  const byLine=by+bh-0.5;              // the bottom border y
  const pxr=bx+bw-16*scale;            // right inset — leaves a visible border stub + corner after "Sign"
  // Measure full footprint so we can break the border line behind it
  const cmsW=c.measureText('CMS Sign').width;
  const pbW=c.measureText('Powered by ').width;
  const dotR=pf*0.45;
  const totalW=pbW+dotR*2+pf*0.6+cmsW;
  c.fillStyle='#ffffff';
  c.fillRect(pxr-totalW-4*scale, byLine-pf*0.72, totalW+6*scale, pf*1.44);
  // Draw right-to-left: "CMS Sign" → badge dot → "Powered by"
  c.fillStyle='#2f479c';
  c.fillText('CMS Sign',pxr,byLine);
  const dotX=pxr-cmsW-pf*0.55-dotR, dotY=byLine;
  c.beginPath();
  c.arc(dotX,dotY,dotR,0,Math.PI*2);
  c.fillStyle='#ec4747'; c.fill();
  c.lineWidth=Math.max(0.5,0.5*scale);
  c.strokeStyle='#2f479c'; c.stroke();
  c.fillStyle='#8a8f99';
  c.fillText('Powered by ',dotX-dotR-pf*0.15,byLine);
  c.restore();
}

// ── INLINE TEXT EDITING (preview mode) ──
function showInlineEdit(box){
  const ie=document.getElementById('inlineEdit');
  if(!ie) return;
  ie.style.display='block';
  ie.style.left=(box.x*scale)+'px';
  ie.style.top=(box.y*scale)+'px';
  ie.style.width=(box.w*scale)+'px';
  ie.style.height=(box.h*scale)+'px';
  ie.style.font=(8*scale)+'px Arial, sans-serif';
  ie.style.paddingLeft=(2*scale)+'px';
  ie.style.lineHeight=(box.h*scale)+'px';
  ie.value=box.previewText||'';
  ie.dataset.boxId=box.id;
  setTimeout(()=>ie.focus(),0);
}

function commitInlineEdit(){
  const ie=document.getElementById('inlineEdit');
  if(!ie||ie.style.display==='none') return;
  const b=allBoxes.find(x=>x.id===+ie.dataset.boxId);
  if(b) b.previewText=ie.value;
  ie.style.display='none';
  drawAllBoxes(); updatePanel();
}

function clearAllPreviewText(){
  if(!allBoxes.some(b=>b.previewText)){showToast('No preview text to clear');return;}
  allBoxes.forEach(b=>b.previewText='');
  drawAllBoxes(); updatePanel();
  showToast('Preview text cleared');
}
function patchCard(id){
  const b=allBoxes.find(b=>b.id===id); if(!b)return;
  const card=document.getElementById(`card-${id}`); if(!card)return;
  const inps=card.querySelectorAll('.cf-inp');
  if(inps[0])inps[0].value=b.x; if(inps[1])inps[1].value=b.y;
  if(inps[2])inps[2].value=b.w; if(inps[3])inps[3].value=b.h;
  updateExportPreview();
}
function deleteBox(id){allBoxes=allBoxes.filter(b=>b.id!==id);if(selectedId===id)selectedId=null;drawAllBoxes();updatePanel();renderSignees();}
function clearAll(){if(!allBoxes.length)return;if(!confirm(`Remove all ${allBoxes.length} box(es)?`))return;allBoxes=[];selectedId=null;drawAllBoxes();updatePanel();renderSignees();}

// ── EXPORT ──
function setFormat(f){
  exportFormat=f;
  document.querySelectorAll('.fmt-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('fmt-'+f).classList.add('active');
  // Show download JSON button only for CMS JSON
  document.getElementById('jsonDlBtn').style.display=(f==='cms'||f==='json')?'inline-flex':'none';
  updateExportPreview();
}
// Returns rows sorted & grouped by signee, then by page within each signee
function getGroupedRows(){
  // Get signees that actually have boxes, in signee order
  const usedSigneeIds=[...new Set(signees.filter(s=>allBoxes.some(b=>b.signeeId===s.id)).map(s=>s.id))];
  const rows=[];
  usedSigneeIds.forEach(sid=>{
    const sBoxes=allBoxes.filter(b=>b.signeeId===sid).sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id);
    sBoxes.forEach(b=>{const s=getSignee(b.signeeId);rows.push({name:b.name,signee:s?.name||'',page:b.page,x:b.x,y:b.y,width:b.w,height:b.h,signeeId:sid,color:s?.color,rgb:s?.rgb});});
  });
  return rows;
}

function buildCMSJson(){
  // Build the exact CMS import format
  const usedSignees=signees.filter(s=>allBoxes.some(b=>b.signeeId===s.id));
  return {
    DocumentID: Math.floor(1000 + Math.random() * 9000),
    DocSignees: usedSignees.map(s=>({
      Order: s.order||1,
      Type: s.type||1,
      Description: s.name,
      IsActive: true,
      DocSignFields: allBoxes
        .filter(b=>b.signeeId===s.id)
        .sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id)
        .map(b=>({
          Page: b.page,
          Type: b.fieldType||0,
          XCoordinate: b.x,
          XOffset: null,
          YCoordinate: b.y,
          YOffset: null,
          Width: b.w,
          Height: b.h,
          TagName: b.name,
          IsInvisible: false,
          IsActive: true
        }))
    }))
  };
}

function getExportData(){
  const data=getGroupedRows();
  if(exportFormat==='cms'){
    return JSON.stringify(buildCMSJson(),null,2);
  }
  if(exportFormat==='csv'){
    const lines=['name,signee,page,x,y,width,height'];
    const usedSigneeIds=[...new Set(signees.filter(s=>allBoxes.some(b=>b.signeeId===s.id)).map(s=>s.id))];
    usedSigneeIds.forEach((sid,si)=>{
      if(si>0) lines.push(''); // blank line between signee groups
      const s=getSignee(sid);
      lines.push(`# --- ${s?.name||''} ---`);
      allBoxes.filter(b=>b.signeeId===sid)
        .sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id)
        .forEach(b=>lines.push(`${b.name},${s?.name||''},${b.page},${b.x},${b.y},${b.w},${b.h}`));
    });
    return lines.join('\n');
  }
  if(exportFormat==='table'){
    const p=(s,n)=>String(s).padEnd(n);
    const h=`${p('NAME',22)} ${p('PAGE',5)} ${p('X',7)} ${p('Y',7)} ${p('W',7)} H`;
    const sep='-'.repeat(h.length);
    const lines=[];
    const usedSigneeIds=[...new Set(signees.filter(s=>allBoxes.some(b=>b.signeeId===s.id)).map(s=>s.id))];
    usedSigneeIds.forEach((sid,si)=>{
      if(si>0) lines.push('');
      const s=getSignee(sid);
      lines.push(`[ ${s?.name||''} ]`);
      lines.push(h); lines.push(sep);
      allBoxes.filter(b=>b.signeeId===sid)
        .sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id)
        .forEach(b=>lines.push(`${p(b.name,22)} ${p(b.page,5)} ${p(b.x,7)} ${p(b.y,7)} ${p(b.w,7)} ${b.h}`));
    });
    return lines.join('\n');
  }
}
function updateExportPreview(){if(allBoxes.length)document.getElementById('expPreview').textContent=getExportData();}
function copyExport(){if(!allBoxes.length)return;navigator.clipboard.writeText(getExportData()).then(()=>showToast('Copied to clipboard'));}

function downloadCMSJson(){
  if(!allBoxes.length) return;
  const payload=buildCMSJson();
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`SignFields-${payload.DocumentID}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CMS JSON downloaded — DocumentID: '+payload.DocumentID);
}

// ── PDF EXPORT (grouped by signee) ──
function exportPDF(){
  if(!allBoxes.length) return;
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
  const pageW=doc.internal.pageSize.getWidth();
  const pageH=doc.internal.pageSize.getHeight();
  const margin=36;

  function drawPageHeader(){
    doc.setFillColor(31,42,74);
    doc.rect(0,0,pageW,46,'F');
    doc.setFillColor(61,126,255); doc.circle(30,23,18,'F');
    doc.setFillColor(160,160,160); doc.circle(30,23,14,'F');
    doc.setFillColor(192,57,43); doc.circle(30,23,10,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('1',30,27,{align:'center'});
    doc.setFontSize(22); doc.text('CMS',58,30);
    doc.setFontSize(11); doc.setFont('helvetica','normal');
    doc.text('CMS Sign — Coordinate Export',58,42);
    doc.setFontSize(9);
    const now=new Date().toLocaleDateString('en-ZA',{year:'numeric',month:'long',day:'numeric'});
    doc.text(now,pageW-margin,30,{align:'right'});
    doc.text(`${allBoxes.length} signature box(es)`,pageW-margin,42,{align:'right'});
  }

  drawPageHeader();
  let y=62;

  const cols=[
    {label:'Field Name', w:160},
    {label:'Page',       w:50},
    {label:'X',          w:58},
    {label:'Y',          w:58},
    {label:'Width',      w:58},
    {label:'Height',     w:58},
  ];
  const rowH=18;

  function drawTableHeader(color){
    const rgb=color||[61,126,255];
    doc.setFillColor(...rgb);
    doc.rect(margin,y,pageW-margin*2,rowH,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('helvetica','bold');
    let cx2=margin+8;
    cols.forEach(c=>{doc.text(c.label,cx2,y+12);cx2+=c.w;});
    y+=rowH;
  }

  // Group by signee (in signee order)
  const usedSignees=signees.filter(s=>allBoxes.some(b=>b.signeeId===s.id));

  usedSignees.forEach((sig,si)=>{
    const sigBoxes=allBoxes.filter(b=>b.signeeId===sig.id)
      .sort((a,b)=>a.page!==b.page?a.page-b.page:a.id-b.id);
    if(!sigBoxes.length) return;

    // Signee heading band
    if(y>pageH-80){doc.addPage();drawPageHeader();y=62;}
    const rgb=sig.rgb.split(',').map(Number);
    // Lighter tint for heading
    const tint=[Math.min(255,rgb[0]+160),Math.min(255,rgb[1]+160),Math.min(255,rgb[2]+160)];
    doc.setFillColor(...tint);
    doc.rect(margin,y,pageW-margin*2,22,'F');
    // Left accent bar in full signee colour
    doc.setFillColor(...rgb);
    doc.rect(margin,y,5,22,'F');
    doc.setTextColor(...rgb.map(v=>Math.max(0,v-60)));
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(sig.name,margin+12,y+15);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.setTextColor(100,110,130);
    doc.text(`${sigBoxes.length} box(es)`,pageW-margin,y+15,{align:'right'});
    y+=26;

    // Column header in signee colour
    drawTableHeader(rgb);

    // Rows
    sigBoxes.forEach((box,idx)=>{
      if(y>pageH-40){doc.addPage();drawPageHeader();y=62;drawTableHeader(rgb);}
      const even=idx%2===0;
      doc.setFillColor(even?248:255,even?250:255,even?255:255);
      doc.rect(margin,y,pageW-margin*2,rowH,'F');
      // Colour stripe
      doc.setFillColor(...rgb);
      doc.rect(margin,y,4,rowH,'F');

      doc.setTextColor(40,40,40); doc.setFontSize(9); doc.setFont('helvetica','normal');
      const vals=[box.name,`Page ${box.page}`,String(box.x),String(box.y),String(box.w),String(box.h)];
      let vx=margin+8;
      cols.forEach((c,i)=>{doc.text(String(vals[i]||''),vx,y+12);vx+=c.w;});
      doc.setDrawColor(210,220,235); doc.setLineWidth(.3);
      doc.line(margin,y+rowH,margin+pageW-margin*2,y+rowH);
      y+=rowH;
    });
    y+=14; // gap between signee groups
  });

  // Footer on every page
  const totalPg=doc.internal.getNumberOfPages();
  for(let i=1;i<=totalPg;i++){
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150,160,175); doc.setFont('helvetica','normal');
    doc.text(`CMS Sign — Coordinate Export  |  Page ${i} of ${totalPg}`,pageW/2,pageH-14,{align:'center'});
  }

  doc.save('cms-signbox-coordinates.pdf');
  showToast('PDF exported');
}


// ── JSON IMPORT ──
const FIELD_TYPE_LABELS={0:'Signature',2:'Date Auto Stamp',5:'Plain Text (Mandatory)',6:'Plain Text (Optional)',9:'Check Box'};
let importPreviewData=null;

function importJSON(inp){
  const file=inp.files[0]; if(!file)return; inp.value='';
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const raw=JSON.parse(e.target.result);
      // Validate it looks like a CMS JSON
      if(!raw.DocSignees||!Array.isArray(raw.DocSignees))
        throw new Error('Missing DocSignees array — not a valid CMS SignFields JSON');
      importPreviewData=raw;
      showImportModal(raw);
    }catch(err){
      showToast('Invalid JSON: '+err.message);
    }
  };
  reader.readAsText(file);
}

function showImportModal(data){
  // Remove existing modal if any
  const existing=document.getElementById('importModal');
  if(existing) existing.remove();

  const signeeColors=["#3d7eff","#ff5c7a","#00e5b0","#ffb545","#b47dff","#ff8c42","#4dd9e8","#ff6ec7"];
  const totalFields=data.DocSignees.reduce((s,sg)=>s+(sg.DocSignFields?.length||0),0);
  const hasExisting=allBoxes.length>0;

  const signeeHTML=data.DocSignees
    .sort((a,b)=>(a.Order||0)-(b.Order||0))
    .map((sg,idx)=>{
      const color=signeeColors[idx%signeeColors.length];
      const fields=sg.DocSignFields||[];
      const fieldRows=fields.slice(0,5).map(f=>`
        <div class="modal-field-row">
          <div class="modal-field-dot" style="background:${color}"></div>
          <span class="modal-field-info">${f.TagName||'—'} &nbsp;·&nbsp; ${FIELD_TYPE_LABELS[f.Type]||'Type '+f.Type} &nbsp;·&nbsp; ${f.Width}×${f.Height}</span>
          <span class="modal-field-pg">PG ${f.Page}</span>
        </div>`).join('');
      const more=fields.length>5?`<div style="font-size:10px;color:var(--ink-4);padding:3px 0 0 14px;">+ ${fields.length-5} more field(s)</div>`:'';
      return`<div class="modal-signee">
        <div class="modal-signee-head">
          <div class="modal-signee-dot" style="background:${color}"></div>
          <span class="modal-signee-name">${sg.Description||'Signee'}</span>
          <span class="modal-signee-meta">Order ${sg.Order||'?'} &nbsp;|&nbsp; Type ${sg.Type||'?'} &nbsp;|&nbsp; ${fields.length} field(s)</span>
        </div>
        ${fieldRows}${more}
      </div>`;
    }).join('');

  const modal=document.createElement('div');
  modal.className='modal-backdrop'; modal.id='importModal';
  modal.innerHTML=`
    <div class="modal">
      <div class="modal-title">📥 Import CMS JSON Preview</div>
      <div class="modal-sub">
        Document ID: <strong>${data.DocumentID||'—'}</strong> &nbsp;·&nbsp;
        ${data.DocSignees.length} signee(s) &nbsp;·&nbsp;
        ${totalFields} total field(s)
      </div>
      <div class="import-warning ${hasExisting?'show':''}" id="importWarn">
        ⚠ You already have ${allBoxes.length} box(es) on the canvas. Importing will <strong>replace</strong> all of them.
      </div>
      <div class="modal-signee-list">${signeeHTML}</div>
      <div class="modal-actions">
        <button class="btn" onclick="closeImportModal()">Cancel</button>
        <button class="btn btn-primary" onclick="applyImport()">✓ Load onto PDF</button>
      </div>
    </div>`;
  // Close on backdrop click
  modal.addEventListener('click',e=>{if(e.target===modal)closeImportModal();});
  document.body.appendChild(modal);
}

function closeImportModal(){
  const m=document.getElementById('importModal');
  if(m) m.remove();
  importPreviewData=null;
}

function applyImport(){
  if(!importPreviewData) return;
  const data=importPreviewData;
  const signeeColors=["#3d7eff","#ff5c7a","#00e5b0","#ffb545","#b47dff","#ff8c42","#4dd9e8","#ff6ec7"];
  const signeeRGBs=["61,126,255","255,92,122","0,229,176","255,181,69","180,125,255","255,140,66","77,217,232","255,110,199"];

  // Clear existing boxes AND signees — rebuild entirely from JSON
  allBoxes=[];
  selectedId=null;
  multiSelected.clear();
  signees=[];
  signeeCounter=0;

  // Build signees fresh from JSON
  const importedSignees=[];
  data.DocSignees.sort((a,b)=>(a.Order||0)-(b.Order||0)).forEach((sg,idx)=>{
    signeeCounter++;
    const color=signeeColors[idx%signeeColors.length];
    const rgb=signeeRGBs[idx%signeeRGBs.length];
    const newSignee={id:signeeCounter,name:sg.Description||`Signee_${idx+1}`,color,rgb,order:sg.Order||idx+1,type:sg.Type||1};
    signees.push(newSignee);
    importedSignees.push({signee:newSignee,fields:sg.DocSignFields||[]});
  });

  // Create boxes from fields
  importedSignees.forEach(({signee,fields})=>{
    fields.forEach(f=>{
      boxCounter++;
      allBoxes.push({
        id:boxCounter,
        name:f.TagName||`Field_${boxCounter}`,
        signeeId:signee.id,
        page:f.Page||1,
        x:f.XCoordinate||0,
        y:f.YCoordinate||0,
        w:f.Width||80,
        h:f.Height||30,
        fieldType:f.Type||0
      });
    });
  });

  closeImportModal();

  // Set active signee to first imported
  if(importedSignees.length) activeSigneeId=importedSignees[0].signee.id;

  // Navigate to first page that has boxes
  const firstPage=allBoxes.length?Math.min(...allBoxes.map(b=>b.page)):1;
  currentPage=firstPage;

  renderSignees();
  renderPage(currentPage).then(()=>{
    updatePanel();
    showToast(`Imported ${allBoxes.length} field(s) from JSON`);
  });
}


// ── CROSS-TAB CLIPBOARD (localStorage) ──
const XTAB_KEY = 'cms_signbox_xtab_clipboard';

function copyToCrossTab(){
  const boxes = getSelectedBoxes();
  if(!boxes.length){ showToast('Select boxes first'); return; }
  const payload = {
    timestamp: Date.now(),
    count: boxes.length,
    boxes: boxes.map(b => ({...b})) // exact copies — same name, type, coords, signeeId etc.
  };
  try {
    localStorage.setItem(XTAB_KEY, JSON.stringify(payload));
    showToast(`${boxes.length} box(es) copied to cross-tab clipboard`);
  } catch(e) {
    showToast('Storage error — try fewer boxes');
  }
}

function checkCrossTabClipboard(){
  try {
    const raw = localStorage.getItem(XTAB_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function updateCrossTabBanner(){
  const data = checkCrossTabClipboard();
  const banner = document.getElementById('xtabBanner');
  const countEl = document.getElementById('xtabCount');
  if(data && data.boxes && data.boxes.length){
    countEl.textContent = data.boxes.length;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

function clearCrossTab(){
  localStorage.removeItem(XTAB_KEY);
  document.getElementById('xtabBanner').classList.remove('show');
  showToast('Cross-tab clipboard cleared');
}

function pasteFromCrossTab(){
  const data = checkCrossTabClipboard();
  if(!data || !data.boxes || !data.boxes.length){
    showToast('Cross-tab clipboard is empty');
    return;
  }
  // Show page picker modal
  showCrossTabPagePicker(data);
}

function showCrossTabPagePicker(data){
  const existing = document.getElementById('xtabPageModal');
  if(existing) existing.remove();

  let pagesBtns = '';
  for(let p = 1; p <= totalPages; p++){
    const isCur = p === currentPage;
    pagesBtns += `<button class="align-btn wide" onclick="applyCrossTabPaste(${p})"
      style="padding:7px 10px;font-size:12px;${isCur?'border-color:var(--mint);color:var(--mint);':''}">
      Page ${p}${isCur?' ★':''}
    </button>`;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop'; modal.id = 'xtabPageModal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">📌 Paste ${data.boxes.length} box(es) to Page</div>
      <div class="modal-sub">
        Boxes will be pasted at the <strong>exact same coordinates</strong> as the source,
        preserving field names, signees, and field types.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;">${pagesBtns}</div>
      <div class="modal-actions">
        <button class="btn" onclick="document.getElementById('xtabPageModal').remove()">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

function applyCrossTabPaste(targetPage){
  const data = checkCrossTabClipboard();
  if(!data || !data.boxes) return;

  const newIds = [];
  data.boxes.forEach(src => {
    boxCounter++;
    // Paste at exact same X/Y — same name, fieldType, dimensions, everything
    // Map signeeId: try to match by signeeId first, then fall back to first signee
    let mappedSigneeId = src.signeeId;
    if(!signees.find(s => s.id === mappedSigneeId)){
      // Signee doesn't exist in this tab — create it using name from src if available
      // or just use the first available signee
      mappedSigneeId = signees[0]?.id || 1;
    }
    allBoxes.push({
      ...src,
      id: boxCounter,
      page: targetPage,
      signeeId: mappedSigneeId,
      // Keep everything else exactly: name, x, y, w, h, fieldType
    });
    newIds.push(boxCounter);
  });

  // Select the pasted boxes
  multiSelected.clear();
  newIds.forEach(id => multiSelected.add(id));
  setTool('multi');

  // Navigate to target page
  currentPage = targetPage;
  document.getElementById('xtabPageModal').remove();

  renderPage(currentPage).then(() => {
    updatePanel(); renderSignees(); updateAlignPanel();
    showToast(`${newIds.length} box(es) pasted onto page ${targetPage}`);
  });
}

// Listen for cross-tab clipboard changes from other tabs
window.addEventListener('storage', e => {
  if(e.key === XTAB_KEY) updateCrossTabBanner();
});

// Keyboard: Ctrl+Shift+V = paste from cross-tab
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey) && e.shiftKey && e.key==='V'){
    e.preventDefault();
    pasteFromCrossTab();
  }
});

// ── TOAST ──
function showToast(msg){const t=document.getElementById('toast');t.textContent='✓ '+msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}

// ── INIT ──
renderSignees();
updateCrossTabBanner(); // check if another tab already has something copied

// Inline editor wiring
(function(){
  const ie=document.getElementById('inlineEdit');
  if(!ie) return;
  ie.addEventListener('blur',commitInlineEdit);
  ie.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();commitInlineEdit();}
    if(e.key==='Escape'){ie.style.display='none';drawAllBoxes();}
    e.stopPropagation();
  });
})();