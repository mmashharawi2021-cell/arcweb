import {readdirSync,readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {commandIcons} from '../commandIconRegistry'
function luminance(hex:string){const rgb=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
describe('command icons',()=>{
 it('registers every static ribbon command id',()=>{for(const file of readdirSync(new URL('../../ribbon/',import.meta.url)).filter(file=>file.endsWith('.tsx'))){const src=readFileSync(new URL('../../ribbon/'+file,import.meta.url),'utf8');for(const match of src.matchAll(/\bid="([\w-]+)"/g))expect(commandIcons[match[1]],match[1]).toBeDefined()}})
 it('role colours have 3:1 contrast in both themes',()=>{const css=readFileSync(new URL('../../index.css',import.meta.url),'utf8');const palettes:{dark:Record<string,string>;light:Record<string,string>}={dark:{},light:{}};for(const match of css.matchAll(/(:root(?:\[data-theme="light"\])?)\s*\{([^}]+)\}/g)){const theme=match[1].includes('light')?'light':'dark';for(const token of match[2].matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})/g))palettes[theme][token[1]]=token[2]}for(const theme of ['dark','light'] as const){const palette={...palettes.dark,...(theme==='light'?palettes.light:{})};for(const role of ['map','create','output','danger','neutral']){const a=luminance(palette['--icon-'+role]),b=luminance(palette['--panel']);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(3)}}})
})
