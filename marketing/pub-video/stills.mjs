import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill} from '@remotion/renderer';
import path from 'node:path';
const browserExecutable=process.env.REMOTION_BROWSER || null;
const serveUrl=await bundle({entryPoint:path.resolve('src/index.ts')});
const [id,...frames]=process.argv.slice(2);
const composition=await selectComposition({serveUrl,id,browserExecutable});
for(const f of frames){await renderStill({composition,serveUrl,frame:+f,output:`out/${id}-${f}.png`,browserExecutable,scale:0.5});}
