import { BookOpen,Keyboard,Info } from 'lucide-react'
import {RibbonButton,RibbonGroup} from './RibbonParts'
import {RibbonGroupBar} from './RibbonGroupBar'

export function HelpRibbon({onShortcuts,onAbout}:{onShortcuts:()=>void;onAbout:()=>void}){return <RibbonGroupBar><RibbonGroup label="Help" icon={BookOpen}><RibbonButton id="help-shortcuts" label="Keyboard Shortcuts" icon={Keyboard} size="large" onClick={onShortcuts}/><RibbonButton id="help-about" label="About ArcWeb" icon={Info} size="large" onClick={onAbout}/></RibbonGroup></RibbonGroupBar>}
