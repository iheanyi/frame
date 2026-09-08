import type { CSSProperties } from 'react';
import type { TapStyle } from '../packages/editor-core/index';
import './EditAppearance.css';

export function EditAppearance({volume,onVolume,audio,style: savedStyle,onStyle,count,disabled,hidden,onShow}:{volume:number;onVolume:(v:number)=>void;audio:boolean;style?:TapStyle|null;onStyle:(v:TapStyle)=>void;count:number;disabled:boolean;hidden:boolean;onShow:()=>void}){
 const style=savedStyle??{};
 const color=style.color??'#ffe0bb',size=style.size??30,bloom=style.bloom??.5;
 return <div className="appearance-panel">
  <section className="appearance-section" aria-label="Audio settings">
   <div className="appearance-heading"><h4>Audio</h4><button type="button" disabled={!audio||disabled} onClick={()=>onVolume(volume?0:1)}>{volume?'Mute':'Unmute'}</button></div>
   <label className="appearance-control"><span>Volume<output>{Math.round(volume*100)}%</output></span><input name="edit-volume" aria-label="Recording volume" type="range" min="0" max="1" step=".01" value={volume} disabled={!audio||disabled} onChange={e=>onVolume(Number(e.target.value))}/></label>
   {!audio&&<p>No audio in this recording.</p>}
  </section>
  <section className="appearance-section" aria-label="Tap appearance" tabIndex={-1}>
   <div className="appearance-heading"><h4>Tap highlights</h4><span>{count}</span></div>
   <div className="appearance-color-row"><span>Color</span><div className="appearance-swatches">{['#ffe0bb','#ffffff','#7dd3fc','#c4b5fd'].map(c=><button type="button" key={c} aria-label={`Tap color ${c}`} aria-pressed={c===color} disabled={disabled} style={{'--swatch':c} as CSSProperties} onClick={()=>onStyle({...style,color:c})}/>)}<input name="tap-color" type="color" aria-label="Custom tap color" title="Custom color" value={color} disabled={disabled} onChange={e=>onStyle({...style,color:e.target.value})}/></div></div>
   <label className="appearance-control"><span>Size<output>{size} px</output></span><input name="tap-size" aria-label="Tap size" type="range" min="12" max="100" value={size} disabled={disabled} onChange={e=>onStyle({...style,size:Number(e.target.value)})}/></label>
   <label className="appearance-control"><span>Bloom<output>{Math.round(bloom*100)}%</output></span><input name="tap-bloom" aria-label="Tap bloom" type="range" min="0" max="1" step=".05" value={bloom} disabled={disabled} onChange={e=>onStyle({...style,bloom:Number(e.target.value)})}/></label>
   <p>Applies to all tap highlights.</p>
   {hidden&&count>0&&<button type="button" className="appearance-show" onClick={onShow}>Show highlights in preview</button>}
  </section>
 </div>;
}
